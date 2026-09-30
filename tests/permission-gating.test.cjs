/*
 * permission-gating.test.cjs — an unticked page loses its sidebar link.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Users & Permissions page draws one checkbox per permission_components
 * row, and applyGating() in src/services/permissions-service.js is what hides
 * a page's sidebar link when its box is unticked. It found links by reading
 * onclick="cNav('x',this)". GL-DEF-01 converted all 31 sidebar links to
 * data-gl-action="cNav" data-gl-arg1="x", after which applyGating matched
 * nothing: every unticked page kept its link. The click was still refused by
 * the cNav guard, so nothing leaked, but "untick what they should not see"
 * did not do what it says. Found while adding Warehouse Storage to the page.
 *
 * WHAT THIS DRIVES
 * ----------------
 * The real index.html and the real permissions-service.js, with window.supa
 * replaced before any script runs by a stand-in that answers the three
 * queries loadPermissions() makes: the signed-in user, their profiles row,
 * the component catalogue and their per-user overrides. Login goes through
 * the real window.loginUser.
 *
 * Run:  NODE_PATH=… node tests/permission-gating.test.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8951;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

// The catalogue as production has it for the pages exercised here.
const COMPONENTS = [
  { id: 'page.dashboard', label: 'Dashboard', category: 'page', default_on: true, sort_order: 10 },
  { id: 'page.samples', label: 'Sample Shipments', category: 'page', default_on: true, sort_order: 71 },
  { id: 'page.warehouse', label: 'Warehouse Storage', category: 'page', default_on: true, sort_order: 72 },
  { id: 'page.vendors', label: 'Vendors', category: 'page', default_on: true, sort_order: 121 },
];

function initScript(role, overrides) {
  return `(() => {
    const USER = { id: 'u-test', email: 't@local' };
    const ROWS = {
      profiles: [{ id: 'u-test', role: ${JSON.stringify(role)} }],
      permission_components: ${JSON.stringify(COMPONENTS)},
      user_permissions: ${JSON.stringify(overrides.map(([c, g]) => ({ user_id: 'u-test', component_id: c, granted: g })))},
    };
    function Q(t){ this.t = t; }
    ['select','eq','neq','in','is','not','order','limit','gte','lte','ilike','or','range','insert','update','upsert','delete']
      .forEach((m) => { Q.prototype[m] = function(){ return this; }; });
    Q.prototype.maybeSingle = function(){ return Promise.resolve({ data: (ROWS[this.t] || [])[0] || null, error: null }); };
    Q.prototype.single = Q.prototype.maybeSingle;
    Q.prototype.then = function(res, rej){ return Promise.resolve({ data: ROWS[this.t] || [], error: null }).then(res, rej); };
    const fake = {
      from: (t) => new Q(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => ({ on(){ return this; }, subscribe(){ return this; } }),
      removeChannel(){},
      storage: { from: () => ({}) },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: USER } } }),
        getUser: () => Promise.resolve({ data: { user: USER } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
        signOut: () => Promise.resolve({}),
      },
    };
    // Whatever the page assigns, supa stays the stand-in.
    Object.defineProperty(window, 'supa', { configurable: true, get: () => fake, set: () => {} });
  })();`;
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(b);
  });
});

async function run(browser, role, overrides) {
  const page = await browser.newPage();
  await page.addInitScript(initScript(role, overrides));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.loginUser === 'function' && typeof window.glCan === 'function', null, { timeout: 15000 });
  const out = await page.evaluate(async (role) => {
    // loadPermissions() starts at boot and the stand-in answers at once; give
    // it a beat so login happens with permissions loaded, as in production.
    await new Promise((r) => setTimeout(r, 1000));
    const u = { id: 'u-test', email: 't@local', role, name: 'T', status: 'active' };
    window.loginUser(u);
    window.currentUser = u;
    await new Promise((r) => setTimeout(r, 2600));      // boot re-applies gating at 800 and 2000 ms
    const shown = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    const res = {
      warehouseLink: shown('nav-warehouse'),
      samplesLink: shown('nav-samples'),
      vendorsLink: shown('nav-vendors'),
      canWarehouse: window.glCan('page.warehouse'),
    };
    window.cNav('dashboard', null);
    window.cNav('warehouse', document.getElementById('nav-warehouse'));
    res.opensWarehouse = document.getElementById('cpg-warehouse').classList.contains('act');
    return res;
  }, role);
  await page.close();
  return out;
}

(async () => {
  console.log('Permission gating — an unticked page loses its sidebar link\n');

  const perms = fs.readFileSync(path.join(ROOT, 'src/services/permissions-service.js'), 'utf8');
  check('gating reads data-gl-action links, not only onclick',
    /getAttribute\('data-gl-action'\) === 'cNav'/.test(perms) && /data-gl-arg1/.test(perms));
  const mig = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /permission_component_warehouse/.test(f));
  check('a migration adds page.warehouse to the catalogue', mig.length === 1 &&
    /'page\.warehouse', 'Warehouse Storage', 'page'/.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations', mig[0]), 'utf8')));

  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  const salesDefault = await run(browser, 'sales', []);
  check('sales, nothing unticked: Warehouse Storage link shown and opens', salesDefault.warehouseLink && salesDefault.opensWarehouse, JSON.stringify(salesDefault));

  const salesOff = await run(browser, 'sales', [['page.warehouse', false], ['page.samples', false]]);
  check('sales, Warehouse Storage unticked: link hidden', !salesOff.warehouseLink, JSON.stringify(salesOff));
  check('sales, Warehouse Storage unticked: page refused', !salesOff.opensWarehouse, JSON.stringify(salesOff));
  check('an older page unticked (Sample Shipments) now also hides its link', !salesOff.samplesLink, JSON.stringify(salesOff));
  check('a page left ticked (Vendors) stays visible', salesOff.vendorsLink, JSON.stringify(salesOff));

  const adminOff = await run(browser, 'admin', [['page.warehouse', false]]);
  check('admin ignores the checkbox, as for every page', adminOff.warehouseLink && adminOff.opensWarehouse, JSON.stringify(adminOff));

  const whOn = await run(browser, 'warehouse', [['page.warehouse', true]]);
  check('warehouse role: ticking the box does not bypass the role limit', !whOn.warehouseLink && !whOn.opensWarehouse, JSON.stringify(whOn));

  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
