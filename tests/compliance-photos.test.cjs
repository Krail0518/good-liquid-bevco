/*
 * compliance-photos.test.cjs — GL-038.
 *
 * WHY THIS EXISTS
 * ---------------
 * crm-compliance.js had uploaded to a "compliance-photos" Storage bucket since
 * 20260517_phase3_extras.sql shipped its RLS policies. The bucket was never
 * created, so three features had never worked: hold-tag evidence photos,
 * defect/NCR photos, and PCQI-signed controlled documents.
 *
 * The bucket is now created PRIVATE (20260829020000), matching client-docs and
 * sales-decks. Portal customers are competing beverage brands and these files
 * are FDA-defensible evidence, so a public bucket — which serves any object to
 * anyone holding a guessable URL, with no auth and no RLS — was not an option.
 *
 * Private has a consequence the client code has to respect, and it is the part
 * that is easy to regress:
 *
 *   getPublicUrl() cannot work      — the /object/public/ URL returns 400
 *   a signed URL expires            — so it must never be persisted
 *
 * Therefore nothing durable may store a URL. The stored value is the object
 * PATH; a signed URL is minted at display time. This test asserts that
 * property, because reintroducing getPublicUrl() would look correct in review
 * and fail only at runtime, silently, on evidence records.
 *
 * Run:  node tests/compliance-photos.test.cjs
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

const src = read('crm-compliance.js');

console.log('compliance-photos — a private bucket forbids storing URLs\n');

// ── the bucket must be created by a migration, not the dashboard ─────
// CLAUDE.md rule 2: never change database permissions through the dashboard.
// The old failure messages literally instructed staff to do exactly that.
const migDir = path.join(ROOT, 'supabase', 'migrations');
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const creating = migrations.filter((f) =>
  /insert\s+into\s+storage\.buckets/i.test(fs.readFileSync(path.join(migDir, f), 'utf8')) &&
  /compliance-photos/.test(fs.readFileSync(path.join(migDir, f), 'utf8'))
);
check('a migration creates the compliance-photos bucket', creating.length > 0,
  'the bucket would have to be made by hand in the dashboard, which CLAUDE.md rule 2 forbids');

if (creating.length) {
  const mig = fs.readFileSync(path.join(migDir, creating[0]), 'utf8');
  check('the bucket is created private', /'compliance-photos',\s*\n?\s*false/.test(mig) || /public\s*=\s*false/.test(mig),
    'a public bucket serves FDA evidence to anyone with the URL, no auth, no RLS');
  check('the migration refuses to proceed if the bucket is public', /must be private/.test(mig),
    'a dashboard flip to public should fail loudly rather than pass silently');
  check('the migration refuses to proceed if an anon policy exists', /anon/.test(mig) && /refusing/.test(mig),
    'a private bucket with an anon policy is public in effect');
  check('the migration carries a ROLLBACK note', /ROLLBACK:/.test(mig));
}

// ── the client must not store URLs ───────────────────────────────────
console.log('');
check('no getPublicUrl call against compliance-photos remains',
  !/compliance-photos'\)\.getPublicUrl/.test(src) &&
  !/from\(PHOTO_BUCKET\)\.getPublicUrl/.test(src),
  'the bucket is private — that URL returns 400, and the failure is silent');

check('a signing helper exists',
  /window\.glCompliancePhotoUrl\s*=/.test(src) && /createSignedUrl/.test(src),
  'without it every call site would hand-roll signing');

check('the helper passes through legacy full URLs',
  /\^https\?:/.test(src),
  'rows written before the bucket went private hold a URL, not a path — ' +
  'treating those as paths would break records that currently work');

// The uploaders must hand back a path. If one starts returning a signed URL
// again the callers will persist it, and it will be expired by the time
// anyone opens the record.
for (const fn of ['uploadPhoto', 'uploadCompliancePhoto']) {
  const body = (src.match(new RegExp('async function ' + fn + '\\([\\s\\S]*?\\n  \\}', 'm')) || [''])[0];
  check(fn + '() returns the object path, not a URL',
    /return path;/.test(body) && !/publicUrl/.test(body),
    'a persisted signed URL is expired long before the record is reopened');
}

// ── what gets persisted ──────────────────────────────────────────────
console.log('');
check('the PCQI document record stores file_path, not file_url',
  /file_path:\s*stored/.test(src) && !/file_url:\s*url/.test(src),
  'file_url held a public URL that a private bucket never answers');

check('the document Open control signs on demand',
  /gl-doc-open/.test(src) && /glCompliancePhotoUrl\(ref/.test(src),
  'a plain href to a stored URL cannot work against a private bucket');

check('legacy file_url records still open',
  /d\.file_path \|\| d\.file_url/.test(src),
  'existing DOC-CTRL-001 rows predate the change and must keep working');

check('the hold-tag photo persists a path',
  /window\.__glLastHoldPhoto = preview\.dataset\.path/.test(src),
  'it previously stashed a URL, which is now either dead or expiring');

check('the defect photo persists a path',
  /window\.__glLastDefectPhoto = path;/.test(src),
  'same reason as the hold-tag photo');

// ── the UI must stop asking staff to create the bucket by hand ───────
console.log('');
check('no message tells staff to create the bucket in the dashboard',
  !/Create the .{0,40}compliance-photos.{0,40}Storage bucket/i.test(src) &&
  !/create the compliance-photos bucket/i.test(src),
  'the bucket now exists, and asking for a dashboard change contradicts CLAUDE.md rule 2');

// An upload that failed must not report success — the operator has to know the
// evidence file is not there.
check('a failed document upload says the signature was not recorded',
  /no signature was recorded/.test(src),
  'staff would otherwise believe a signed controlled document exists');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
