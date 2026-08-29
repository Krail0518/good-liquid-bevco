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

// ── GL-034: the pageerror filter must not swallow real crashes ───────
// A filter meant to reduce CI noise had also removed the signal. This drives
// the ACTUAL regex out of smoke.test.cjs rather than asserting on its text, so
// the test cannot pass against a filter that has quietly been widened again.
console.log('');
const smoke = fs.readFileSync(path.join(TESTS, 'smoke.test.cjs'), 'utf8');

/*
 * Reconstruct the live filter. Handles BOTH shapes deliberately: with an
 * ALWAYS_APP_BUG override, and the older noise-only form. Against the old
 * form the crash assertions below then fail with a real message — "this
 * genuine app error would be discarded" — instead of the test bailing out
 * with "couldn't extract", which would say nothing useful to whoever
 * reintroduced the regression.
 */
function extractFilter(src) {
  const noise = src.match(/return (\/(?:[^\n]*?)\/i)\.test\(msg\);/);
  if (!noise) return null;
  // eslint-disable-next-line no-eval
  const N = eval(noise[1]);
  const always = src.match(/const ALWAYS_APP_BUG\s*=\s*\n?\s*(\/.+?\/i);/s);
  if (!always) return (msg) => N.test(msg);          // pre-fix shape
  // eslint-disable-next-line no-eval
  const A = eval(always[1]);
  return (msg) => (A.test(msg) ? false : N.test(msg));
}

const isNoise = extractFilter(smoke);
check('the pageerror filter can be extracted from smoke.test.cjs', !!isNoise,
  'its shape changed — update this test rather than deleting it');
check('an ALWAYS_APP_BUG override exists', /ALWAYS_APP_BUG/.test(smoke),
  'without it, a crash naming a library or status code is filtered as noise');

if (isNoise) {
  // Real crashes: must NOT be treated as noise.
  const crashes = [
    'Maximum call stack size exceeded',
    "Cannot read properties of undefined (reading 'supabase')",
    'renderPermissionsPanel is not defined',
    'window.glEsc is not a function',
    "Cannot set properties of null (setting 'innerHTML')",
  ];
  for (const c of crashes) {
    check('crash NOT filtered: ' + c.slice(0, 52), isNoise(c) === false,
      'this genuine app error would be discarded and the run would go green');
  }

  // Genuine CI noise: SHOULD still be filtered, or the suite cries wolf and
  // gets ignored — which is how the real hole survived last time.
  const noise = [
    'Failed to fetch',
    'net::ERR_NAME_NOT_RESOLVED',
    'Access to fetch blocked by CORS policy',
    'Failed to load resource: the server responded with a status of 403',
  ];
  for (const n of noise) {
    check('noise still filtered: ' + n.slice(0, 52), isNoise(n) === true,
      'CI would go red on expected sandbox noise');
  }
}

// full-sweep must use the same list, or the two suites disagree about what a
// crash is.
const sweepSrc = fs.readFileSync(path.join(TESTS, 'full-sweep.cjs'), 'utf8');
check('full-sweep applies the same ALWAYS_APP_BUG override',
  /ALWAYS_APP_BUG/.test(sweepSrc) && /ALWAYS_APP_BUG\.test\(m\)/.test(sweepSrc));

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
