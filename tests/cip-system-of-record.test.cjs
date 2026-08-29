/*
 * cip-system-of-record.test.cjs — GL-026 / GL-027.
 *
 * WHY THIS EXISTS
 * ---------------
 * crm-cip-audit.js had a localStorage fallback meant to surface CIP cycles
 * whose database write had been rejected. It read the key 'gl_cip_logs'. The
 * only function that wrote that key, saveLocal(), was declared and never
 * called — so nothing had ever written it, loadLocal() could only return [],
 * and the fallback was unreachable.
 *
 * Meanwhile dbInsert() in crm-compliance.js *does* preserve a rejected
 * record — under 'gl_cache_compliance_records', a different key. So the work
 * was on disk and the CIP page rendered "No cycles logged yet". An operator
 * could not tell an FDA-required sanitation record that failed to file from a
 * cycle nobody had logged.
 *
 * The warning attached to that dead branch also named the wrong table
 * ("Check RLS on public.cip_logs"), sending debuggers to a table this module
 * has never read. See ADR-0001: compliance_records is the system of record;
 * cip_logs is empty and deprecated.
 *
 * This test asserts the reader and the writer agree on a key, which is the
 * property that actually broke. It is plain node — no browser.
 *
 * Run:  node tests/cip-system-of-record.test.cjs
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

const cip        = read('crm-cip-audit.js');
const compliance = read('crm-compliance.js');

console.log('CIP system of record — the reader and the writer must agree\n');

// ── the reader/writer contract ───────────────────────────────────────
// Pull the key the CIP page reads, and the key crm-compliance.js writes when
// an insert is rejected, out of the real sources. Comparing the two is the
// whole point: asserting a hard-coded string would pass even if the writer
// moved.
const readKey = (cip.match(/var LOCAL_KEY\s*=\s*'([^']+)'/) || [])[1];
const cachePrefix = (compliance.match(/function localCacheKey\(table\)\{\s*return\s*'([^']+)'/) || [])[1];

check('the CIP page names the key it reads', !!readKey,
  'expected `var LOCAL_KEY = \'...\'` in crm-cip-audit.js');
check('crm-compliance.js still caches rejected rows under a known prefix', !!cachePrefix,
  'localCacheKey() changed shape — this test needs updating with it');

if (readKey && cachePrefix) {
  check('the CIP page reads the key crm-compliance.js actually writes',
    readKey === cachePrefix + 'compliance_records',
    `reads "${readKey}", writer produces "${cachePrefix}compliance_records" — ` +
    'a rejected CIP record would be invisible on the page');
}

// The specific dead key and its dead writer must not come back.
check('the orphan key gl_cip_logs is no longer read or written',
  !/localStorage\.(get|set)Item\(\s*'gl_cip_logs'/.test(cip),
  'nothing writes that key, so reading it can only ever return []');
check('the dead saveLocal() is gone',
  !/function\s+saveLocal\s*\(/.test(cip),
  'this module is read-only; a write helper here is dead code by construction');

// ── the fallback must be reachable ───────────────────────────────────
// The old merge only fired when the DB came back completely empty, so one
// existing cycle server-side — the normal case — hid every pending record.
check('pending records are shown regardless of how many rows the DB returned',
  /var pending = local\.filter/.test(cip) && /pending\.concat\(dbRows\)/.test(cip),
  'found no unconditional merge of local-only rows into the rendered list');
check('the empty-DB-only condition is gone',
  !/rows\.length === 0 && local\.length > 0/.test(cip),
  'that branch hides a rejected save as soon as any other cycle exists');

// ── the operator has to be able to see and fix it ────────────────────
check('unsaved cycles are surfaced in the UI, not just the console',
  /NOT SAVED/.test(cip) && /glRetryCipPending/.test(cip),
  'a console.warn is invisible to the operator who has to re-file the record');
check('a retry exists and re-sends the original payload',
  /window\.glRetryCipPending\s*=/.test(cip) && /from\('compliance_records'\)\.insert/.test(cip),
  'surfacing the problem without offering the fix leaves the operator stuck');

// CLAUDE.md rule: an RLS-rejected write returns 0 rows and no error, so the
// retry cannot treat "no error" as success.
check('the retry proves the write landed by counting returned rows',
  /Array\.isArray\(res\.data\) && res\.data\.length === 1/.test(cip),
  'a silently-dropped write would be reported to the operator as saved');

// ── ADR-0001: nothing should reference the deprecated table ──────────
console.log('');
const CLIENT_FILES = fs.readdirSync(ROOT).filter(
  (f) => /^crm-.*\.js$/.test(f) || /^(index|auditor|portal)\.html$/.test(f)
);
const offenders = [];
for (const f of CLIENT_FILES) {
  read(f).split(/\r?\n/).forEach((line, i) => {
    if (!/cip_logs/.test(line)) return;
    // A comment explaining why the table is deprecated is the point, not a
    // violation. Only flag it where it is used as a table name.
    if (/^\s*(\/\/|\*|<!--)/.test(line) || /--$/.test(line.trim())) return;
    if (/rest\(\s*'cip_logs|from\('cip_logs'|'cip_logs'\s*,|,\s*'cip_logs'/.test(line)) {
      offenders.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 100));
    }
  });
}
check('no client code queries the deprecated cip_logs table (ADR-0001)',
  offenders.length === 0,
  offenders.join('\n          ') ||
  'compliance_records under form_code GMP-SAN-002 is the system of record');

// The auditor page fetched three tables into variables it never read — one
// wasted round trip each, on a page an external FDA auditor loads.
const auditor = read('auditor.html');
for (const dead of ['cip_logs', 'defects?order=created_at', 'hold_tags?order=created_at']) {
  check('auditor.html no longer makes the dead probe: ' + dead,
    !auditor.includes(dead),
    'its result was assigned to a variable and never used');
}

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
