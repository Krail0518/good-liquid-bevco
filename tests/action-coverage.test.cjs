/*
 * action-coverage.test.cjs — every data-gl-action ON SCREEN resolves.
 *
 * WHY THIS EXISTS, AND WHY THE STATIC GUARD WAS NOT ENOUGH
 * -------------------------------------------------------
 * inline-handler-budget.test.cjs already checks that every data-gl-action in
 * the codebase names something registered. It does that by scanning source for
 * the literal attribute:
 *
 *     /data-gl-action="([A-Za-z_$][\w$]*)"/
 *
 * gmp.js builds the attribute from a variable instead:
 *
 *     '<button data-gl-action="' + action + '"' + argAttr + ' …'
 *
 * so the literal never appears and the scan sees nothing. Four action names
 * went unregistered behind that blind spot — glOpenGMPRegister,
 * glOpenGMPDeviations, glOpenGMPDocuments, glGenerateAuditorLink — which is
 * FIFTEEN dead tiles on the GMP page: all six registers, all six PRP
 * registers, plus Open deviations, Auditor access and Documents. The entire
 * food-safety register section did nothing when clicked.
 *
 * Three GMP suites were green throughout. They were testing around the
 * dispatcher rather than through it:
 *
 *   gmp-documents.test.cjs called window.glOpenGMPDocuments() directly, so the
 *     function was proven to work while its button was not.
 *   gmp-prp.test.cjs asserted the markup CONTAINS
 *     data-gl-action="glOpenGMPRegister", which is true of a dead control too.
 *
 * That is exactly the trap smoke.test.cjs warns about in its own comment:
 * "Test the button the way a user presses it, or you test nothing."
 *
 * So this test asks the only question that cannot be dodged: after rendering,
 * is every action named in the live DOM actually in the registry? It reads the
 * DOM rather than source, so it does not care how the attribute was built.
 *
 * Run:  NODE_PATH=… PW_CHROMIUM=… REPO_ROOT=… node tests/action-coverage.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8791;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

// The pages worth rendering. Each is a section that draws its own controls, so
// the DOM only holds a section's actions once that section has been opened.
const PAGES = ['gmp', 'compliance', 'invoices', 'clients', 'dashboard'];

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const base = 'http://localhost:' + PORT;
  console.log('Action coverage — every data-gl-action on screen must resolve\n');

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

  // Nothing may reach the network: served locally, the app still points at
  // production Supabase, and this test must never write or send anything.
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) {
      return route.continue();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.alert = function () {};
    window.confirm = function () { return true; };
    window.prompt = function () { return ''; };
  });

  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', is_admin: true, name: 'Test Admin' };
    const p = document.getElementById('crm-panel');
    if (p) p.classList.add('show');
    if (typeof window.initCRM === 'function') window.initCRM();
  });
  await page.waitForTimeout(2500);

  check('the action registry is available',
    await page.evaluate(() => typeof window.glActionNames === 'function'),
    'glActionNames() missing — actions.js did not load, so this test proves nothing');

  // Render each section, then collect. Sections draw on demand, so an action
  // only reaches the DOM once its page has been shown at least once.
  for (const p of PAGES) {
    await page.evaluate((name) => {
      try { if (typeof window.showPage === 'function') window.showPage(name); } catch (e) {}
    }, p);
    await page.waitForTimeout(700);
  }

  const result = await page.evaluate(() => {
    const registered = window.glActionNames();
    const found = {};
    for (const el of document.querySelectorAll('[data-gl-action]')) {
      const n = el.getAttribute('data-gl-action');
      found[n] = (found[n] || 0) + 1;
    }
    const names = Object.keys(found);
    return {
      registeredCount: registered.length,
      distinctOnScreen: names.length,
      controlsOnScreen: Object.values(found).reduce((a, b) => a + b, 0),
      dead: names.filter((n) => !registered.includes(n)).map((n) => n + ' (' + found[n] + ' control' + (found[n] > 1 ? 's' : '') + ')'),
    };
  });

  console.log('    (registered: ' + result.registeredCount +
              ' · distinct on screen: ' + result.distinctOnScreen +
              ' · controls on screen: ' + result.controlsOnScreen + ')');

  check('every data-gl-action rendered into the DOM is registered',
    result.dead.length === 0,
    result.dead.join(', ') +
    '\n          Add the name to src/shared/action-registry.js. A control whose ' +
    'action is not registered does nothing when clicked — the dispatcher logs ' +
    '"no action registered" and shows "Control not wired up", which nobody sees ' +
    'unless they happen to have the console open.');

  // The blind spot itself, held to what exists today. A second dynamic site is
  // not forbidden, but it must be a deliberate choice: every one of them is
  // invisible to the source scan in inline-handler-budget.test.cjs, and this
  // browser test only covers the sections it renders above.
  const DYNAMIC_BUDGET = 1;
  const dynamicSites = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (/data-gl-action="'\s*\+|data-gl-action="\$\{/.test(line)) {
            dynamicSites.push(path.relative(ROOT, p).split(path.sep).join('/') + ':' + (i + 1));
          }
        });
      }
    }
  })(path.join(ROOT, 'src'));

  console.log('    (data-gl-action built from a variable: ' + dynamicSites.length +
              ' of ' + DYNAMIC_BUDGET + ' allowed — ' + (dynamicSites.join(', ') || 'none') + ')');

  check('dynamically-built action names are not spreading',
    dynamicSites.length <= DYNAMIC_BUDGET,
    dynamicSites.join(', ') +
    '\n          Each of these is invisible to the source scan that guards the ' +
    'registry, which is how 15 GMP tiles shipped dead. Prefer a literal ' +
    'data-gl-action="name"; if it must be dynamic, make sure the section is ' +
    'rendered by the PAGES list above so this test can see it.');

  await browser.close();
  server.close();

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
