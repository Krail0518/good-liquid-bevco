/*
 * documents-storage.test.cjs — GL-042. The Documents page had never worked.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three separate faults stacked on the same feature:
 *
 * 1. saveDocument() inserted `file_url` and `file_path` into public.documents.
 *    Neither column existed — 20260523 created the table with metadata only —
 *    so PostgREST rejected every insert with PGRST204 and no document was ever
 *    saved. Production held 0 rows.
 *
 * 2. The value being stored was a getPublicUrl() on `client-docs`, which is a
 *    PRIVATE bucket. That URL returns HTTP 400 (probed). A signed URL would
 *    have been no better: it expires, so persisting one just moves the failure
 *    to whenever someone opens the record.
 *
 * 3. renderDocs() drew a name, metadata and a delete button — and no download
 *    control at all. Even with 1 and 2 fixed, the upload was write-only.
 *
 * The file is uploaded BEFORE the insert, so each failed attempt also left an
 * object in the bucket with nothing pointing at it.
 *
 * This is a plain-node test: it reads the sources and asserts the contract
 * between them. The behaviour it guards spans index.html, a migration and the
 * storage bucket's privacy, and no one of those alone shows the bug.
 *
 * Run:  node tests/documents-storage.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const html = read('index.html');
const extras = read('crm-crm-extras.js');

console.log('documents storage — the column, the URL, and the way back out\n');

// ── 1. the column has to exist ───────────────────────────────────────
const MIG = path.join(ROOT, 'supabase', 'migrations');
const migs = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql'));
const addsPath = migs.filter((f) => {
  const src = fs.readFileSync(path.join(MIG, f), 'utf8');
  return /alter table public\.documents/i.test(src) && /add column if not exists file_path/i.test(src);
});
check('a migration adds documents.file_path', addsPath.length > 0,
  'without it PostgREST rejects the insert with PGRST204 and nothing is saved');

if (addsPath.length) {
  const mig = fs.readFileSync(path.join(MIG, addsPath[0]), 'utf8');
  check('that migration refuses to add a file_url column', /file_url/.test(mig) && /raise exception/i.test(mig),
    'a stored URL cannot work against a private bucket — the guard stops it coming back');
  check('that migration carries a ROLLBACK note', /ROLLBACK:/.test(mig));
}

// The insert must name only columns that exist. file_url is the one that
// silently broke everything.
check('saveDocument no longer inserts file_url',
  !/file_url:\s*fileUrl/.test(html) && !/file_url:\s*\w+\s*,\s*\n\s*file_path/.test(html),
  'that column does not exist on public.documents');
check('saveDocument still records file_path',
  /file_path:\s*filePath/.test(html),
  'without it the row cannot point at the uploaded file');

// ── 2. no URL may be persisted for a private bucket ──────────────────
console.log('');
check('nothing calls getPublicUrl on client-docs',
  !/client-docs'\)\.getPublicUrl/.test(html),
  'client-docs is private — that URL returns HTTP 400');
check('the uploader returns a path, not a url',
  /return \{ path, error: null \}/.test(html) && !/return \{ url: urlData\.publicUrl/.test(html),
  'a URL for a private bucket is either dead or expiring; the path is the only durable reference');
check('the save guard checks the path it now receives',
  /result\.error \|\| !result\.path/.test(html),
  'checking result.url against an uploader that returns a path would reject every upload');
check('the upload-progress wrapper checks the path too',
  /!result \|\| !result\.path/.test(extras),
  'crm-crm-extras.js wraps uploadDocToSupabase and had its own !result.url check');

// ── 3. the file has to be retrievable ────────────────────────────────
console.log('');
check('loadDocs selects file_path',
  /uploaded_at, file_path'\)/.test(html),
  'the client cannot offer a download for a path it never fetched');
check('the row model carries filePath',
  /filePath: d\.file_path/.test(html),
  'renderDocs reads d.filePath');
check('renderDocs offers a download control',
  /glDownloadDocById/.test(html) && /Download<\/button>/.test(html),
  'the page rendered a delete button and no way to get the file back — upload was write-only');
check('a document with no file says so rather than offering a dead button',
  /no file<\/span>/.test(html),
  'a Download button that cannot work is worse than none');
check('the download signs on demand',
  /createSignedUrl\(path, 300, \{ download/.test(html),
  'a private bucket has no public URL, and a stored signed URL would be expired');

// ── 4. a write that saved nothing must not report success ────────────
// CLAUDE.md rule 4: RLS refuses silently — 0 rows, no error.
console.log('');
check('the insert asks for rows back and treats 0 rows as failure',
  /\}\]\)\.select\('id'\);/.test(html) &&
  /!Array\.isArray\(r\.data\) \|\| r\.data\.length === 0/.test(html),
  'RLS rejects silently, so a bare `if(r.error)` reports success while nothing saved');

// ── 5. path shape ────────────────────────────────────────────────────
check('a document with no client gets its own prefix',
  /'general'/.test(html) && /\$\{folder\}\//.test(html),
  'the old path began with a bare slash; the customer-read policy matches ' +
  "on name LIKE '<client_id>/%'");

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
