/*
 * compliance-attribution.test.cjs — GL-043, found while triaging GL-040.
 *
 * WHY THIS EXISTS
 * ---------------
 * GL-040 flagged 19 localStorage keys that are read but never written. Most
 * were benign: 13 are one-way legacy migration readers, two are read only in
 * order to delete a legacy secret, one is an alias fallback whose primary key
 * IS written. One was not.
 *
 * crm-compliance-ext.js resolved the acting user like this:
 *
 *     function getCurrentUserId(){
 *       var u = window.__GL && window.__GL.session && window.__GL.session.user;
 *       if(u && u.id) return u.id;
 *       return null;
 *     }
 *
 * Nothing in this codebase ever assigns window.__GL. The property is read in
 * exactly two places and written in none, so this returned null on every call.
 * Every other user lookup in the same file already used window.currentUser.
 *
 * That null fed two columns where it matters:
 *
 *   inspector_tokens.created_by
 *     Who granted an external FDA auditor access to compliance data. An
 *     unattributed grant is exactly the record an audit trail exists for.
 *
 *   compliance_records.second_signed_by
 *     The dual-PCQI co-signature. second_signature_name is free text typed at
 *     a prompt(); second_signed_by is the only field tying that name to a real
 *     account. Null there means a co-signed FDA record attributable to nobody.
 *
 * No bad rows had accumulated (the one existing inspector token came through a
 * different path, and nothing had been co-signed yet), but the path was live.
 *
 * Run:  node tests/compliance-attribution.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'crm-compliance-ext.js'), 'utf8')
  .split('\r\n').join('\n');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('compliance attribution — a signature has to name someone real\n');

// ── the lookup must use a source that is actually populated ──────────
const fnMatch = src.match(/function getCurrentUserId\(\)\{([\s\S]*?)\n  \}/);
check('getCurrentUserId exists', !!fnMatch);

if (fnMatch) {
  const body = fnMatch[1];
  check('it reads window.currentUser',
    /window\.currentUser/.test(body),
    'window.__GL is never assigned anywhere in this codebase, so reading only ' +
    'that returns null on every call');
  check('window.currentUser is checked before the __GL fallback',
    body.indexOf('window.currentUser') < body.indexOf('__GL'),
    'the never-populated source must not shadow the working one');

  // Execute it. This is the whole point: a source-text assertion would pass
  // against a version that reads the right property and still returns null.
  const runnable = body
    .replace(/var u = window\.currentUser;/, 'var u = ctx.currentUser;')
    .replace(/window\.__GL/g, 'ctx.__GL');
  // eslint-disable-next-line no-new-func
  const getId = new Function('ctx', runnable + '\n  return null;');

  check('returns the id when currentUser is set',
    getId({ currentUser: { id: 'u-123' } }) === 'u-123',
    'got: ' + JSON.stringify(getId({ currentUser: { id: 'u-123' } })));
  check('falls back to __GL.session when it is populated',
    getId({ __GL: { session: { user: { id: 'u-456' } } } }) === 'u-456');
  check('returns null when nobody is signed in',
    getId({}) === null);
}

// ── the dead misattributing helper is gone ───────────────────────────
console.log('');
check('the dead getCurrentUserName is gone',
  !/getCurrentUserName/.test(src),
  'it was never called, read the same never-set property, and fell back to a ' +
  "hard-coded person's name — on a compliance module");
check("no hard-coded person's name remains as a user fallback",
  !/gl_user_display_name/.test(src),
  'that key is written by nothing, so the hard-coded default always won');

// ── an unidentified co-signer must be refused ────────────────────────
console.log('');
check('the co-signature refuses when the signer cannot be identified',
  /var signerId = getCurrentUserId\(\);/.test(src) &&
  /if\(!signerId\)\{/.test(src),
  'storing a null second_signed_by files an FDA co-signature attributable to nobody');
check('the refusal happens before the update is built',
  src.indexOf('if(!signerId){') < src.indexOf('second_signed_by: signerId'),
  'the guard must short-circuit, not annotate after the fact');
check('the co-signature stores the resolved id',
  /second_signed_by: signerId/.test(src),
  'it must persist the value the guard actually checked');

// ── the inspector-token grant is attributed ──────────────────────────
check('an inspector token records who created it',
  /created_by: getCurrentUserId\(\)/.test(src),
  'granting an external auditor access to compliance data is the kind of act ' +
  'an audit trail exists to record');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
