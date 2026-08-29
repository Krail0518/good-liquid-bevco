/*
 * test-integrity.test.cjs — the test suite must not score absence as success.
 *
 * WHY THIS EXISTS
 * ---------------
 * full-sweep.cjs checked 18 modal openers. When one was not defined at runtime
 * it recorded a PASS with the reason "skipped: not defined in this build":
 *
 *     openers.forEach(o=>{ if(o.ok===null) rec('Modal openers',o.fn,true,'skipped: '+o.why);
 *
 * All 18 exist in the shipped source, so the only way one goes undefined is
 * that its module threw or failed to load — precisely the outage the sweep
 * exists to catch. A module could stop loading entirely and turn all 18 checks
 * green. The suite reported hardest on the days it was working least.
 *
 * That failure mode is invisible from inside a green run, so it needs its own
 * guard. This file asserts the property structurally, and is deliberately
 * cheap: plain node, no browser, no page load.
 *
 * Run:  node tests/test-integrity.test.cjs
 */

const fs = require('fs');
const path = require('path');

const TESTS = path.join(__dirname);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const sweep = fs.readFileSync(path.join(TESTS, 'full-sweep.cjs'), 'utf8');

console.log('test integrity — absence must never be scored as success\n');

// ── the specific regression ──────────────────────────────────────────
check('full-sweep no longer records a PASS for an undefined opener',
  !/if\(o\.ok===null\)\s*rec\([^)]*,\s*true\s*,\s*'skipped/.test(sweep),
  "found the old `if(o.ok===null) rec(..., true, 'skipped: ...')` scoring");

check('an undefined opener is recorded as a failure',
  /o\.ok===null[\s\S]{0,600}?rec\([^;]*?false/.test(sweep),
  'no false-scoring branch found for the ok===null case');

check('optional openers are declared explicitly rather than assumed',
  /OPTIONAL_OPENERS/.test(sweep),
  'expected an explicit allowlist so absence is opt-in, not the default');

// ── the general property, across every suite ─────────────────────────
// A `rec(...)`/`check(...)` whose condition is a bare `true` is asserting
// nothing. Flag any that also mention skipping, which is the shape that hid
// this bug.
const suspicious = [];
for (const f of fs.readdirSync(TESTS)) {
  if (!/\.(cjs|mjs)$/.test(f) || f === 'test-integrity.test.cjs') continue;
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (/\b(rec|check)\s*\([^)]*,\s*true\s*,\s*['"](skip|skipped|not defined|n\/a)/i.test(line)) {
      suspicious.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 110));
    }
  });
}
check('no suite records a hard-coded PASS for a skipped or undefined check',
  suspicious.length === 0,
  suspicious.join('\n          '));

// ── the smoke test's own blind spot ──────────────────────────────────
// GL-034: the pageerror filter is broad enough to swallow real crashes, which
// guts the "no fatal JS error" assertion. Not fixed here — this records that
// the filter exists and is worth narrowing, so the next reader sees it.
const smoke = fs.readFileSync(path.join(TESTS, 'smoke.test.cjs'), 'utf8');
const hasErrorFilter = /pageerror/.test(smoke);
if (hasErrorFilter) {
  console.log('\n  NOTE  smoke.test.cjs filters pageerror output (GL-034).');
  console.log('        A filter that is too broad hides genuine crashes behind a green run.');
  console.log('        Tracked in docs/plans/technical-debt.md; not addressed by this file.');
}

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
