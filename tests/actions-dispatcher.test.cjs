/*
 * actions-dispatcher.test.cjs — GL-DEF-01 phase 1.
 *
 * Drives src/shared/actions.js in a real browser. Source assertions cannot
 * prove a delegated listener works; only clicking can.
 *
 * The properties that matter, and why:
 *
 *   - an unregistered action FAILS LOUDLY. A converted control that silently
 *     does nothing produces no console error and no failed request — the
 *     button is simply dead. That is the logoutCRM shape, and it is the single
 *     most likely way this migration breaks the CRM without anyone noticing.
 *
 *   - arguments survive hostile input EXACTLY. The channel is
 *     data-gl-arg1="${esc(v)}" read through dataset. CLAUDE.md rule 5 says
 *     JSON-in-attribute is not an escape; this proves the chosen alternative
 *     actually round-trips, rather than trusting the reasoning.
 *
 *   - the registry is an ALLOWLIST. Today an inline handler reaches any global.
 *     If the dispatcher fell back to window[name] it would reproduce that, and
 *     the main security benefit of the migration would be gone.
 *
 * Run:  NODE_PATH=... PW_CHROMIUM=... node tests/actions-dispatcher.test.cjs
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'shared', 'actions.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const ESC = `function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){` +
  `return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}`;

const HOSTILE = [
  `plain-id-123`,
  `O'Brien & Sons`,
  `" onmouseover="alert(1)`,
  `"><img src=x onerror=alert(2)>`,
  `</script><script>alert(3)</script>`,
  `back\\slash "quoted" 'single'`,
];

(async () => {
  console.log('action dispatcher — delegated events, allowlisted actions\n');

  check('src/shared/actions.js exists', fs.existsSync(SRC));
  if (!fs.existsSync(SRC)) { console.log('\n1 CHECK(S) FAILED'); process.exit(1); }

  const src = fs.readFileSync(SRC, 'utf8');

  // Comments are stripped before any structural scan. The header of
  // actions.js explains WHY it does not look up window[name], and that
  // sentence contains the literal string — the check failed on its own
  // rationale. Third time in this codebase a comment has broken the test
  // meant to guard it (see test-integrity.cjs and the <script> in a template
  // literal), so it is worth doing properly rather than rewording the prose.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // The registry must not FALL BACK to arbitrary globals.
  //
  // Phase 3 introduced glRegisterGlobalActions, which does look up
  // window[name] — but only inside a thunk created for a name that was
  // explicitly registered. The allowlist is the list of names, not the state
  // of window, so that lookup is fine. What must never exist is a lookup on
  // the DISPATCH path, where an unregistered name would still resolve.
  //
  // The behavioural check further down is the real proof; this one keeps the
  // dispatch path itself honest.
  const dispatchPath = (code.match(/function run\([\s\S]*?\n  \}/) || [''])[0];
  check('the dispatch path never falls back to window[name]',
    !/window\s*\[/.test(dispatchPath),
    'an unregistered name would resolve, reproducing exactly the surface this ' +
    'migration exists to shrink');
  check('the global-name lookup is gated on registration',
    /glRegisterGlobalActions[\s\S]{0,400}?glRegisterAction\(/.test(code),
    'window[name] may only be reached through a name that was registered');
  check('an unregistered action is reported, not ignored',
    /no action registered/.test(src) && /console\.error/.test(src),
    'a silent no-op is a dead button with nothing in the console');

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  await page.setContent('<div id="host"></div>');
  await page.addScriptTag({ content: ESC });
  await page.addScriptTag({ content: src });

  check('the dispatcher exposes its registration API',
    await page.evaluate(() => typeof window.glRegisterAction === 'function' &&
      typeof window.glRegisterActions === 'function' &&
      typeof window.glActionNames === 'function'));

  // ── a registered action runs, with its arguments ─────────────────────
  const basic = await page.evaluate(() => {
    window.__calls = [];
    window.glRegisterAction('noteIt', function (a, b) { window.__calls.push([a, b]); });
    document.getElementById('host').innerHTML =
      '<button id="b1" data-gl-action="noteIt" data-gl-arg1="alpha" data-gl-arg2="beta">go</button>';
    document.getElementById('b1').click();
    return window.__calls;
  });
  check('a registered action runs on click', basic.length === 1, JSON.stringify(basic));
  check('positional arguments arrive in order',
    basic[0] && basic[0][0] === 'alpha' && basic[0][1] === 'beta',
    JSON.stringify(basic[0]));

  // ── hostile arguments survive intact ─────────────────────────────────
  const round = await page.evaluate((payloads) => {
    const out = [];
    window.glRegisterAction('capture', function (v) { out.push(v); });
    const host = document.getElementById('host');
    for (const p of payloads) {
      host.innerHTML = '<button data-gl-action="capture" data-gl-arg1="' + esc(p) + '">x</button>';
      host.querySelector('button').click();
    }
    return out;
  }, HOSTILE);
  const mismatched = HOSTILE.filter((p, i) => round[i] !== p);
  check('hostile arguments round-trip byte-identically',
    mismatched.length === 0,
    mismatched.map((p) => JSON.stringify(p)).join(' | '));
  check('no payload escaped the attribute to fire a dialog',
    dialogs.length === 0, dialogs.join(', '));

  // ── an unregistered action fails loudly ──────────────────────────────
  const before = consoleErrors.length;
  await page.evaluate(() => {
    document.getElementById('host').innerHTML =
      '<button data-gl-action="doesNotExist">x</button>';
    document.querySelector('[data-gl-action="doesNotExist"]').click();
  });
  const after = consoleErrors.length;
  check('an unregistered action logs an error',
    after > before && /doesNotExist/.test(consoleErrors[consoleErrors.length - 1] || ''),
    'console errors went ' + before + ' -> ' + after);

  // ── the registry is an allowlist, not a window lookup ────────────────
  const escaped = await page.evaluate(() => {
    window.__leaked = false;
    window.notRegistered = function () { window.__leaked = true; };
    document.getElementById('host').innerHTML =
      '<button data-gl-action="notRegistered">x</button>';
    document.querySelector('[data-gl-action="notRegistered"]').click();
    return window.__leaked;
  });
  check('an unregistered GLOBAL is not reachable as an action', escaped === false,
    'the dispatcher fell through to window — the allowlist is not an allowlist');

  // ── the generic close ────────────────────────────────────────────────
  const closed = await page.evaluate(() => {
    const host = document.getElementById('host');
    host.innerHTML =
      '<div id="ov" class="modal-ov"><button id="x1" data-gl-close="">close</button></div>' +
      '<div id="byid"><button id="x2" data-gl-close="#byid">close</button></div>' +
      '<div id="hid" class="show"><button id="x3" data-gl-close="#hid" data-gl-close-mode="hide">h</button></div>';
    document.getElementById('x1').click();
    document.getElementById('x2').click();
    document.getElementById('x3').click();
    return {
      nearestRemoved: !document.getElementById('ov'),
      byIdRemoved: !document.getElementById('byid'),
      hiddenNotRemoved: !!document.getElementById('hid') &&
        !document.getElementById('hid').classList.contains('show'),
    };
  });
  check('data-gl-close="" removes the nearest .modal-ov', closed.nearestRemoved);
  check('data-gl-close="#id" removes that element', closed.byIdRemoved);
  check('data-gl-close-mode="hide" drops .show instead of removing',
    closed.hiddenNotRemoved);

  // ── event type is honoured ───────────────────────────────────────────
  const evType = await page.evaluate(() => {
    window.__n = 0;
    window.glRegisterAction('countIt', function () { window.__n++; });
    document.getElementById('host').innerHTML =
      '<input id="i1" data-gl-action="countIt" data-gl-on="change">';
    const el = document.getElementById('i1');
    el.click();                                              // wrong type: must not fire
    const afterClick = window.__n;
    el.dispatchEvent(new Event('change', { bubbles: true })); // right type: must fire
    return { afterClick, afterChange: window.__n };
  });
  check('an action bound to change does not fire on click', evType.afterClick === 0);
  check('an action bound to change fires on change', evType.afterChange === 1);

  // ── phase 1 must not have converted anything ─────────────────────────
  console.log('');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html still loads the dispatcher',
    /src="\/src\/shared\/actions\.js"/.test(indexHtml),
    'the file exists but nothing loads it');
  // This used to assert that NOTHING was converted, which was right for
  // phase 1 and wrong the moment phase 3 landed. Deleting it would lose the
  // property worth keeping: every converted control must name something the
  // registry knows, or it is a dead button.
  check('index.html loads the generated action registry',
    /src="\/src\/shared\/action-registry\.js"/.test(indexHtml),
    'the converted controls name actions that only that file registers');

  const registryJs = fs.readFileSync(path.join(ROOT, 'src/shared/action-registry.js'), 'utf8');
  const usedInHtml = [...new Set([...indexHtml.matchAll(/data-gl-action="([^"]+)"/g)]
    .map((m) => m[1]))];
  const missing = usedInHtml.filter((n) => !registryJs.includes("'" + n + "'"));
  check('every converted control in index.html is registered',
    missing.length === 0,
    missing.join(', ') + ' — the dispatcher logs an error and does nothing, ' +
    'which looks exactly like a working button');
  console.log('    (' + usedInHtml.length + ' distinct actions used in index.html)');

  console.log('\n  page errors during the run: ' + pageErrors.length +
    (pageErrors.length ? ' :: ' + pageErrors[0] : ''));
  if (pageErrors.length) failures++;

  await browser.close();
  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('harness crash:', e); process.exit(1); });
