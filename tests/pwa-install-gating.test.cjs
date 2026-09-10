/*
 * pwa-install-gating.test.cjs
 *
 * index.html serves the public marketing site, the staff CRM and the
 * customer portal from one page. The install banner advertises the STAFF
 * CRM by name ("Install Good Liquid CRM"), and it used to be mounted by an
 * unconditional beforeinstallprompt handler — so every visitor to the
 * public marketing site, and every portal customer, was repeatedly nudged
 * to install a CRM they can never sign into.
 *
 * These checks pin the fix. They are structural: they read the shipped
 * source rather than driving a browser, because beforeinstallprompt needs
 * Chrome to judge the app installable over HTTPS, which CI cannot stage.
 * That makes them a ratchet against the gate being removed later, not a
 * substitute for the runtime verification done on the pull request.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PWA = read('src/shared/pwa-install.js');
const CORE = read('crm-index-core.js');
const NAV = read('src/shared/nav.js');

let failures = 0;
function check(name, ok, detail){
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name);
  if(!ok){ failures++; if(detail) console.log('        ' + detail); }
}

console.log('\nPWA install banner is staff-only');

check('the module was read', PWA.length > 0);

/* ── The gate ─────────────────────────────────────────────────────── */

check('a staff-CRM gate exists',
  /function isStaffCrmOpen\(\)/.test(PWA),
  'isStaffCrmOpen() is the single place that decides who may see the banner.');

check('the gate reads #crm-panel.show',
  /getElementById\('crm-panel'\)/.test(PWA) && /classList\.contains\('show'\)/.test(PWA),
  'loginUser() adds .show to #crm-panel on staff sign-in. That class is the ' +
  'only signal separating staff from a marketing-site visitor, and the ' +
  'element is absent entirely in portal mode.');

/* The banner builder must refuse to run when the gate is closed, whatever
   calls it — the event listener, a sign-in path, or a future caller. */
const builder = PWA.slice(PWA.indexOf('function showInstallBanner()'));
const body = builder.slice(0, builder.indexOf('\n}'));

check('showInstallBanner() returns early unless the staff CRM is open',
  /if\(!isStaffCrmOpen\(\)\)\s*return;/.test(body),
  'Without this the gate can be bypassed by any caller.');

check('the guard precedes appending the banner',
  body.indexOf('isStaffCrmOpen()') >= 0 &&
  body.indexOf('isStaffCrmOpen()') < body.indexOf('appendChild'),
  'The guard must run before the DOM is touched.');

/* ── The event handler ────────────────────────────────────────────── */

const handler = PWA.slice(PWA.indexOf("addEventListener('beforeinstallprompt'"));
const handlerBody = handler.slice(0, handler.indexOf('\n});'));

check('beforeinstallprompt does not mount the banner unconditionally',
  !/^\s*showInstallBanner\(\);\s*$/m.test(handlerBody),
  'This is the exact regression: a bare showInstallBanner() call here puts ' +
  'the pop-up in front of every marketing-site visitor.');

check('beforeinstallprompt still captures the prompt',
  /deferredPrompt = e;/.test(handlerBody),
  'The event must be stashed so staff can still install after signing in.');

/* ── Both orderings ───────────────────────────────────────────────── */

check('a deferred entry point exists for the sign-in side',
  /function maybeShowInstallBanner\(\)/.test(PWA),
  'The browser can offer the prompt before OR after sign-in, so the banner ' +
  'must be reachable from both.');

check('the sign-in paths call it',
  (CORE.match(/maybeShowInstallBanner\(\)/g) || []).length >= 2,
  'crm-index-core.js must call it from loginUser and from the sign-in ' +
  'handler, or a prompt offered before login is never shown.');

/* ── Leaving the CRM ──────────────────────────────────────────────── */

/* The banner is position:fixed and outlives the panel it belongs to, so
   dropping .show is not enough — without an explicit removal it sits over
   the public marketing site, which is the very thing this fix prevents. */
const exitCRM = CORE.slice(CORE.indexOf('function exitCRM()'));
check('exitCRM removes the banner',
  /pwa-install-banner/.test(exitCRM.slice(0, exitCRM.indexOf('\n'))),
  'Otherwise a staff member who leaves the CRM leaves the banner behind, ' +
  'on top of the marketing site.');

check('the nav logout removes the banner too',
  /pwa-install-banner/.test(NAV),
  'nav.js holds the second exit path; both must drop it.');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
