/*
 * duplicate-declarations.test.cjs — GL-044.
 *
 * WHY THIS EXISTS
 * ---------------
 * index.html holds one inline <script> of ~9,300 lines declaring 323 top-level
 * functions. Two names were declared twice:
 *
 *   logoutCRM   (line 4700 and line 5287)
 *   saveReferrer
 *
 * Two top-level `function` declarations with the same name do not conflict —
 * the LAST one silently wins, for every call site, including ones that appear
 * textually above both. Verified rather than assumed:
 *
 *   function f(){ return 'first'; }
 *   const early = f();                 // 'second'
 *   function f(){ return 'second'; }
 *
 * For logoutCRM the winner happened to be the correct one: it calls
 * supa.auth.signOut() and resets crmInited. The dead copy only cleared local
 * state and left the Supabase session valid. So sign-out worked by accident of
 * declaration order.
 *
 * That is the part that matters. GL-037 extracts this inline block into
 * src/modules/ one capability at a time — which reorders code by definition.
 * Moving the live logoutCRM above the dead one, or extracting one and not the
 * other, would have silently reverted logout to "clears the screen, keeps the
 * session" with nothing failing and nothing to see in review.
 *
 * So this guard is a precondition for that refactor, not a tidiness check.
 *
 * Run:  node tests/duplicate-declarations.test.cjs
 */

const fs = require('fs');
const path = require('path');

const { ROOT, coreScript } = require('./_sources.cjs');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('duplicate declarations — the last one silently wins\n');

// The hazard itself, demonstrated. If a future JS engine ever changed this,
// the guard below would be unnecessary — so assert the semantics hold.
(function () {
  /* eslint-disable no-func-assign, no-redeclare */
  function f() { return 'first'; }
  const early = f();
  function f() { return 'second'; }
  check('a later top-level declaration wins, even for earlier calls',
    early === 'second' && f() === 'second',
    'got early=' + early + ' late=' + f());
})();

// ── scan the core script ─────────────────────────────────────────────
// GL-037 moved the inline block into crm-index-core.js verbatim, so the
// declarations this guards now live there. index.html having NO inline script
// is a stronger property than the one originally checked here, and it is what
// the CSP work depends on, so assert that too.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]);
check('index.html carries no inline script block', inline.length === 0,
  'found ' + inline.length + ' — a new inline block reintroduces exactly what ' +
  'the extraction removed');

const code = coreScript();
check('the extracted core script was read', code.length > 100000,
  'got ' + code.length + ' bytes; crm-index-core.js should be ~500KB — if this ' +
  'is short, _sources.cjs needs the newly extracted file adding to CORE_FILES');
// Top-level only: a declaration indented inside a function or IIFE shadows
// nothing outside it, so nested helpers with shared names are fine.
const names = [...code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
  .map((m) => m[1]);

const counts = {};
for (const n of names) counts[n] = (counts[n] || 0) + 1;
const dups = Object.entries(counts).filter(([, c]) => c > 1);

check('no top-level function name is declared twice in the core script',
  code.length > 100000 && dups.length === 0,
  code.length <= 100000
    ? 'the core script could not be read, so this proves nothing'
    : dups.map(([n, c]) => n + ' ×' + c).join(', ') +
      ' — the last declaration wins for every call site, including ones above it');

// ── the specific one that was load-bearing ───────────────────────────
console.log('');
check('logoutCRM is declared exactly once',
  (code.match(/function logoutCRM\(\)/g) || []).length === 1,
  'two copies existed and the surviving behaviour depended on their order');

const logout = code.match(/function logoutCRM\(\)\{[\s\S]*?\n\}/);
check('the surviving logoutCRM ends the Supabase session', !!logout &&
  /supa\.auth\.signOut\(\)/.test(logout[0]),
  'the dead copy cleared local state only, leaving the session token valid — ' +
  'that is the version this must never silently become');
check('the surviving logoutCRM resets crmInited', !!logout && /crmInited\s*=\s*false/.test(logout[0]),
  'without it the CRM does not re-initialise for the next user on this device');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
