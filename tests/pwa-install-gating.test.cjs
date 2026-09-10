/*
 * pwa-install-gating.test.cjs
 *
 * index.html serves the public marketing site, the staff CRM and the
 * customer portal from one page. The PWA install banner advertises the
 * STAFF CRM ("Install Good Liquid CRM"), and it used to be shown by an
 * unconditional beforeinstallprompt handler — so every visitor to the
 * public marketing site got a pop-up inviting them to install a CRM they
 * have no login for.
 *
 * These checks pin the fix: the banner is only ever appended once the
 * staff CRM panel is open.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/shared/pwa-install.js'), 'utf8');

let failures = 0;
function check(name, ok, detail){
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name);
  if(!ok){ failures++; if(detail) console.log('        ' + detail); }
}

console.log('\nPWA install banner gating');

check('the module was read',
  SRC.length > 0);

// The gate itself: whether the staff CRM is open.
check('a staff-CRM gate exists',
  /function staffCrmIsOpen\(\)/.test(SRC),
  'staffCrmIsOpen() is the single place that decides who may see the banner.');

check('the gate reads #crm-panel.show',
  /getElementById\('crm-panel'\)/.test(SRC) && /classList\.contains\('show'\)/.test(SRC),
  'loginUser() in crm-index-core.js adds .show to #crm-panel on staff sign-in. ' +
  'That class is the only signal that separates staff from a marketing-site visitor.');

// The banner builder must refuse to run when the gate is closed, whatever
// calls it — an inline handler, a future caller, or the event listener.
const builder = SRC.slice(SRC.indexOf('function showInstallBanner()'));
const body = builder.slice(0, builder.indexOf('\n}'));
check('showInstallBanner() returns early unless the staff CRM is open',
  /if\(!staffCrmIsOpen\(\)\)\s*return;/.test(body),
  'Without this the gate can be bypassed by any caller.');

check('the guard precedes appending the banner',
  body.indexOf('staffCrmIsOpen()') >= 0 &&
  body.indexOf('staffCrmIsOpen()') < body.indexOf('appendChild'),
  'The guard must run before the DOM is touched.');

// beforeinstallprompt fires on page load, before anyone signs in, so the
// handler must capture the event without showing anything.
const handler = SRC.slice(SRC.indexOf("addEventListener('beforeinstallprompt'"));
const handlerBody = handler.slice(0, handler.indexOf('\n});'));
check('beforeinstallprompt does not show the banner unconditionally',
  !/^\s*showInstallBanner\(\);\s*$/m.test(handlerBody),
  'This is the exact regression: a bare showInstallBanner() call in the ' +
  'handler puts the pop-up in front of every marketing-site visitor.');

check('beforeinstallprompt still captures the prompt',
  /deferredPrompt = e;/.test(handlerBody),
  'The event must be stored so staff can install after signing in.');

check('the banner is deferred until the staff CRM opens',
  /waitForStaffCrm\(\)/.test(handlerBody) && /MutationObserver/.test(SRC),
  'The prompt arrives before sign-in, so the banner waits for #crm-panel.');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
