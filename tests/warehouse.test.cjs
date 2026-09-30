/*
 * warehouse.test.cjs — Warehouse Storage (src/modules/warehouse/warehouse.js)
 *
 * WHAT THIS PROVES
 * ----------------
 * The page, driven the way staff drive it, against an in-memory stand-in for
 * Supabase seeded with the first real transfer (Camo Energy, GL-TR-20260930-01,
 * 7 pallets x 200 cases):
 *
 *   - the dashboard flags an empty-can pallet past 2 days red and a finished
 *     lot under 90 days to best by yellow
 *   - a client name and a SKU description carrying script do not execute
 *     (CLAUDE.md rule 5; CONRI's CSV reaches the page the same way)
 *   - the transfer detail refuses to schedule a SKU never exported to CONRI
 *   - Print paperwork produces 1 packing list + 7 labels with the seeded
 *     numbers on them: 1,400 cases, 16,800 units, 14,000 lbs, "1 of 7"
 *   - the CONRI CSV export neutralises spreadsheet formulas
 *   - reconciliation reports the right differences
 *   - outbound allocation is FEFO: earliest best-by first
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * That the database enforces the rules. Those are triggers, and they were
 * exercised against production inside a rolled-back transaction as staff,
 * portal customer, stranger and anon before the migration was applied (see
 * the migration header). This file tests the page; the triggers are the guard.
 *
 * jsPDF is loaded from node_modules (NODE_PATH), not the CDN, so this runs
 * offline. The barcode was additionally decoded with a real scanner library
 * when this was written; that is not repeated here.
 *
 * Run:  NODE_PATH=… node tests/warehouse.test.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8947;
let JSPDF;
try { JSPDF = require.resolve('jspdf/dist/jspdf.umd.min.js'); } catch (e) { JSPDF = null; }

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

function isoDaysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const XSS = '<img src=x onerror="window.__xss=1">';
const CAMO = { id: 'c-camo', name: 'Camo Energy' };
const EVIL = { id: 'c-evil', name: 'Evil ' + XSS };
const SKU = { id: 's-glow', client_id: CAMO.id, upc_sku: '6001390576', description: 'Camo Energy Glow', brand: 'Camo Energy',
  pack: '12 count tray', units_per_case: 12, default_cases_per_pallet: 200, default_pallet_weight_lbs: 2000,
  default_pallet_height_in: null, inventory_type: 'finished_good', active: true, notes: null, last_exported_at: null, client: CAMO };
const LOT = { id: 'l-628', sku_id: SKU.id, lot_number: '628290B', production_date: '2026-09-28', best_by_date: '2028-03-28', qa_status: 'released' };
const T1 = { id: 't-1', transfer_number: 'GL-TR-20260930-01', type: 'to_conri_finished', transfer_date: '2026-09-30', status: 'draft',
  scheduled_at: null, client_id: CAMO.id, client: CAMO, carrier: null, ship_to: null, conri_confirmation: null, released_by: 'Mike Krail', notes: null };
const SEED_PALLETS = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
  id: 'p-' + i, pallet_tag: 'GL-P-00000' + i, cases: 200, weight_lbs: 2000, height_in: null, location: 'good_liquid', status: 'staged',
  current_transfer_id: T1.id, received_at_conri: null, expected_pull_date: null, notes: null, sku: SKU, lot: LOT, line_no: i }));

// Dashboard stock at CONRI: one lot close to best-by, one empty-can pallet
// in storage 3 days, and one carrying script in its description.
const SKU_SOON = Object.assign({}, SKU, { id: 's-soon', upc_sku: '012345678905', description: 'Soon Lot Soda', last_exported_at: '2026-09-01T00:00:00Z' });
const LOT_SOON = { id: 'l-soon', sku_id: 's-soon', lot_number: 'SOON1', production_date: '2026-06-01', best_by_date: isoDaysFromNow(30), qa_status: 'released' };
const LOT_LATER = { id: 'l-later', sku_id: 's-soon', lot_number: 'LATER1', production_date: '2026-07-01', best_by_date: isoDaysFromNow(300), qa_status: 'released' };
const SKU_CANS = Object.assign({}, SKU, { id: 's-cans', upc_sku: 'CAN-12OZ', description: 'Empty 12oz cans', inventory_type: 'empty_can', units_per_case: null });
const SKU_EVIL = Object.assign({}, SKU, { id: 's-evil', client_id: EVIL.id, client: EVIL, upc_sku: '999', description: 'Evil ' + XSS });
const threeDaysAgo = new Date(Date.now() - 3 * 86400000 - 3600000).toISOString();
const CONRI_PALLETS = [
  { id: 'q-1', pallet_tag: 'GL-P-000101', cases: 100, weight_lbs: 1800, location: 'conri', status: 'stored', current_transfer_id: null,
    received_at_conri: '2026-09-10T12:00:00Z', sku: SKU_SOON, lot: LOT_LATER },
  { id: 'q-2', pallet_tag: 'GL-P-000102', cases: 100, weight_lbs: 1800, location: 'conri', status: 'stored', current_transfer_id: null,
    received_at_conri: '2026-09-12T12:00:00Z', sku: SKU_SOON, lot: LOT_SOON },
  { id: 'q-3', pallet_tag: 'GL-P-000103', cases: 50, location: 'conri', status: 'stored', current_transfer_id: null,
    received_at_conri: threeDaysAgo, expected_pull_date: isoDaysFromNow(-1), sku: SKU_CANS, lot: null },
  { id: 'q-4', pallet_tag: 'GL-P-000104', cases: 10, location: 'conri', status: 'stored', current_transfer_id: null,
    received_at_conri: '2026-09-20T12:00:00Z', sku: SKU_EVIL, lot: null },
];

const FIX = {
  clients: [CAMO, EVIL],
  wh_transfers: [T1],
  wh_transfer_lines: SEED_PALLETS.map((p) => ({ transfer_id: T1.id, line_no: p.line_no, pallet: p })),
  wh_pallets: SEED_PALLETS.concat(CONRI_PALLETS),
  wh_movements: [],
  wh_outbound_orders: [],
  wh_skus: [SKU, SKU_SOON, SKU_CANS],
  wh_lots: [LOT, LOT_SOON, LOT_LATER],
};

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<div id="cpg-warehouse" class="cpg act"></div>
<script>
window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', name: 'Test Admin' };
window.GL_HOOKS = { _navHooks: [], registerNavHook: function(fn){ this._navHooks.push(fn); } };
var FIX = ${JSON.stringify(FIX)};
window.__writes = [];
function Q(table, op, payload){ this.t = table; this.op = op; this.payload = payload; this.f = []; }
['select','neq','in','is','not','order','limit'].forEach(function(m){ Q.prototype[m] = function(){ return this; }; });
Q.prototype.eq = function(k, v){ this.f.push([k, v]); return this; };
Q.prototype.then = function(res, rej){
  var self = this, rows;
  if(self.op === 'select'){
    rows = (FIX[self.t] || []).filter(function(r){ return self.f.every(function(f){ return r[f[0]] === undefined || r[f[0]] === f[1]; }); });
  } else {
    window.__writes.push({ table: self.t, op: self.op, payload: self.payload, filters: self.f });
    rows = Array.isArray(self.payload) ? self.payload.map(function(r, i){ return Object.assign({ id: self.t + '-new-' + i }, r); })
         : [Object.assign({ id: self.t + '-new' }, self.payload || {})];
  }
  return Promise.resolve({ data: rows, error: null }).then(res, rej);
};
window.supa = { from: function(t){ return {
  select: function(){ return new Q(t, 'select'); },
  insert: function(p){ return new Q(t, 'insert', p); },
  update: function(p){ return new Q(t, 'update', p); },
  delete: function(){ return new Q(t, 'delete'); } }; } };
<\/script>
<script src="/jspdf.umd.min.js"><\/script>
<script>window.ensureJsPdf = function(){ return Promise.resolve(window.jspdf.jsPDF); };<\/script>
<script src="/src/modules/warehouse/warehouse.js"><\/script></body>`;

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (p === '/jspdf.umd.min.js' && JSPDF) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(JSPDF)); }
  if (p === '/src/modules/warehouse/warehouse.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(fs.readFileSync(path.join(ROOT, 'src/modules/warehouse/warehouse.js')));
  }
  res.writeHead(404); res.end();
});

(async () => {
  console.log('Warehouse Storage module\n');

  // ── Static wiring ─────────────────────────────────────────────────
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nav = (html.match(/<div class="cni" id="nav-warehouse"[^>]*>/) || [])[0] || '';
  check('sidebar has a Warehouse Storage link', /Warehouse Storage<\/div>/.test(html) && !!nav);
  check('the link is hidden until an admin logs in', /display:none/.test(nav), nav);
  check('the link routes through cNav to the warehouse page', /data-gl-action="cNav"/.test(nav) && /data-gl-arg1="warehouse"/.test(nav));
  check('the page has a mount point', /<div id="cpg-warehouse" class="cpg"><\/div>/.test(html));
  check('the module is loaded as a classic root-absolute script',
    /<script src="\/src\/modules\/warehouse\/warehouse\.js"><\/script>/.test(html));
  const auth = fs.readFileSync(path.join(ROOT, 'src/services/auth.js'), 'utf8');
  check('admin login reveals the link', /\$\('nav-warehouse'\)/.test(auth));
  const perms = fs.readFileSync(path.join(ROOT, 'src/services/permissions-service.js'), 'utf8');
  check('permission gating keeps it admin-only', /adminOnly = \[[^\]]*'nav-warehouse'/.test(perms));

  if (!JSPDF) { check('jspdf is resolvable from NODE_PATH', false, 'npm install jspdf@2.5.1 next to playwright'); }

  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });

  // ── Dashboard ─────────────────────────────────────────────────────
  await page.evaluate(() => window.glRenderWarehouse());
  await page.waitForSelector('#wh-body .ctbl', { timeout: 5000 });
  const dash = await page.evaluate(() => ({
    text: document.getElementById('wh-body').innerText,
    redRows: [...document.querySelectorAll('#wh-body tr')].filter((r) => /231,\s*76,\s*60/.test(r.getAttribute('style') || '')).map((r) => r.innerText),
    yellowRows: [...document.querySelectorAll('#wh-body tr')].filter((r) => /245,\s*200,\s*66/.test(r.getAttribute('style') || '')).map((r) => r.innerText),
    xss: window.__xss === 1 || !!document.querySelector('#cpg-warehouse img'),
  }));
  check('dashboard totals pallets at CONRI', /PALLETS AT CONRI\s*4/.test(dash.text), dash.text.slice(0, 200));
  check('empty cans past 2 days are flagged red', dash.redRows.some((r) => /GL-P-000103/.test(r) && /3 days/.test(r)), JSON.stringify(dash.redRows));
  check('a finished lot under 90 days to best by is flagged yellow', dash.yellowRows.some((r) => /SOON1/.test(r)), JSON.stringify(dash.yellowRows));
  check('a lot 300 days out is not flagged', !dash.yellowRows.some((r) => /LATER1/.test(r)));
  check('script in a client name / SKU description does not run', !dash.xss);
  check('the escaped payload is shown as text', /<img src=x/.test(dash.text));

  // ── Transfers list -> detail ──────────────────────────────────────
  await page.click('[data-wh="tab"][data-arg="transfers"]');
  await page.waitForSelector('[data-wh="openTransfer"]', { timeout: 5000 });
  const listRow = await page.evaluate(() => document.querySelector('[data-wh="openTransfer"]').innerText);
  check('transfer list shows the seeded transfer with 7 pallets, 1,400 cases',
    /GL-TR-20260930-01/.test(listRow) && /\b7\b/.test(listRow) && /1,400/.test(listRow), listRow);
  await page.click('[data-wh="openTransfer"]');
  await page.waitForSelector('[data-wh="printPaperwork"]', { timeout: 5000 });
  const detail = await page.evaluate(() => ({
    text: document.getElementById('wh-body').innerText,
    schedDisabled: !!(document.querySelector('[data-wh="scheduleTransfer"]') || {}).disabled,
  }));
  check('detail lists pallets "1 of 7" through "7 of 7"', /1 of 7/.test(detail.text) && /7 of 7/.test(detail.text));
  check('detail totals 7 pallets, 1,400 cases, 16,800 units, 14,000 lbs',
    /7 pallets · 1,400 cases · 16,800 units · 14,000 lbs/.test(detail.text), detail.text.slice(0, 400));
  check('a SKU never exported to CONRI blocks scheduling', detail.schedDisabled && /never been exported/.test(detail.text));
  check('a 10-digit UPC is warned about, not rejected', /UPC has 10 digits/.test(detail.text));

  // ── Print paperwork (the real button) ─────────────────────────────
  if (JSPDF) {
    await page.evaluate(() => { window.jspdf.jsPDF.API.save = function(name){ window.__savedName = name; window.__savedPdf = this.output(); return this; }; });
    await page.click('[data-wh="printPaperwork"]');
    await page.waitForFunction(() => !!window.__savedName, null, { timeout: 8000 });
    const pdf = await page.evaluate(() => ({ name: window.__savedName, raw: window.__savedPdf }));
    const pages = (pdf.raw.match(/\/Type \/Page\b/g) || []).length;
    const has = (s) => pdf.raw.indexOf('(' + s) >= 0;
    check('PDF is named for the transfer', pdf.name === 'GL-TR-20260930-01_paperwork.pdf', pdf.name);
    check('PDF has 8 pages: packing list + 7 labels', pages === 8, 'pages=' + pages);
    check('packing list header and number', has('TRANSFER PACKING LIST') && has('Transfer # GL-TR-20260930-01') && has('Transfer date: 09/30/2026'));
    check('ship to is CONRI, attn Paul Nolletti', has('CONRI Services, Inc.') && has('Attn: Paul Nolletti'));
    check('table rows carry pallet, UPC, lot, best by, prod date', has('1 of 7') && has('7 of 7') && has('6001390576') && has('628290B') && has('03/28/2028') && has('09/28/2026'));
    check('totals: 7 pallets, 1,400 cases, 16,800 units, 2,000 lbs each, 14,000 total',
      has('1,400') && has('16,800') && has('2,000 lbs') && /Total weight: 14,000 lbs/.test(pdf.raw));
    check('storage note for finished goods', has('Storage: finished goods, racked, FEFO by best by date'));
    check('receiving block and both signature lines', has('RECEIVING') && has('Released by \\(Good Liquid\\)') && has('Received by \\(CONRI\\)'));
    check('labels: product, pallet 1/7 .. 7/7, tag under barcode', has('CAMO ENERGY GLOW') && has('1/7') && has('7/7') && has('LOT 628290B     GL-P-000001'));
    check('label footer names the route', has('GL-TR-20260930-01   |   09/30/2026   |   Good Liquid Bev Co to CONRI Services'));
    if (process.env.WH_PDF_OUT) fs.writeFileSync(process.env.WH_PDF_OUT, Buffer.from(pdf.raw, 'binary'));
  }

  // ── Pure logic ────────────────────────────────────────────────────
  const pure = await page.evaluate(() => {
    const I = window.glWhInternals;
    const widths = window.glWhCode128('GL-P-000001');
    const csv = I.skuCsv([{ upc_sku: '6001390576', description: '=HYPERLINK("http://x","y")', brand: 'Camo, Inc', units_per_case: 12,
      default_cases_per_pallet: 200, default_pallet_weight_lbs: 2000, inventory_type: 'finished_good' }]);
    const rec = I.reconcile(I.parseCsv('Item Number,Lot #,Pallets,Cases On Hand\r\n6001390576,628290B,6,"1,200"\r\nCAN-12OZ,,1,50\r\n'),
      [1, 2, 3, 4, 5, 6, 7].map((i) => ({ cases: 200, sku: { upc_sku: '6001390576', description: 'Glow' }, lot: { lot_number: '628290B' } })));
    const stock = [
      { id: 'a', pallet_tag: 'A', received_at_conri: '2026-09-01', sku: { id: 's' }, lot: { best_by_date: '2027-06-01', qa_status: 'released' } },
      { id: 'b', pallet_tag: 'B', received_at_conri: '2026-09-05', sku: { id: 's' }, lot: { best_by_date: '2027-01-01', qa_status: 'released' } },
      { id: 'c', pallet_tag: 'C', received_at_conri: '2026-08-01', sku: { id: 's' }, lot: { best_by_date: '2027-01-01', qa_status: 'released' } },
      { id: 'd', pallet_tag: 'D', received_at_conri: '2026-07-01', sku: { id: 's' }, lot: { best_by_date: '2026-12-01', qa_status: 'hold' } },
    ];
    const alloc = I.allocateFefo(stock, { s: 2 });
    return {
      modules: widths.reduce((a, b) => a + b, 0), bars: widths.length,
      csv, rec: rec.rows, alloc: alloc.pallets.map((p) => p.id), short: I.allocateFefo(stock, { s: 4 }).short,
      upc10: I.upcWarning('6001390576'), upc12: I.upcWarning('012345678905'),
      date: I.fmtDate('2026-09-30'),
    };
  });
  check('Code 128 of an 11-char tag is 156 modules (start + 11 + check + stop)', pure.modules === 156 && pure.bars === 85, JSON.stringify(pure));
  check('CSV export neutralises a leading "="', /,"'=HYPERLINK\(""http:\/\/x"",""y""\)",/.test(pure.csv), pure.csv);
  check('CSV quotes a comma in the brand', /"Camo, Inc"/.test(pure.csv));
  check('CSV has CONRI\'s seven columns', pure.csv.split('\r\n')[0] ===
    'SKU/Item Number,Description,Brand/Customer,Case Pack,Cases per Pallet,Pallet Weight (lbs),Inventory Type');
  const glow = pure.rec.find((r) => r.sku === '6001390576');
  const cans = pure.rec.find((r) => r.sku === 'CAN-12OZ');
  check('reconciliation: CONRI shows 1 pallet / 200 cases fewer', glow && glow.dp === -1 && glow.dc === -200 && !glow.match, JSON.stringify(glow));
  check('reconciliation: a line only CONRI has is reported', cans && cans.theirsP === 1 && cans.oursP === 0 && !cans.match);
  check('FEFO: earliest best-by first, then first received; held lots skipped', JSON.stringify(pure.alloc) === '["c","b"]', JSON.stringify(pure.alloc));
  check('allocation reports a shortfall rather than under-shipping', pure.short.length === 1, JSON.stringify(pure.short));
  check('UPC length: 10 digits warns, 12 does not', !!pure.upc10 && !pure.upc12);
  check('date-only values are not shifted by timezone', pure.date === '09/30/2026');

  // ── Scheduling email ──────────────────────────────────────────────
  await page.click('[data-wh="schedEmail"]');
  await page.waitForSelector('#wem-body', { timeout: 5000 });
  const mail = await page.evaluate(() => ({ body: document.getElementById('wem-body').value, href: document.getElementById('wem-open').getAttribute('href') }));
  check('scheduling email goes to CONRI', /^mailto:pnolletti%40conriservices\.com\?subject=/.test(mail.href), mail.href.slice(0, 80));
  check('email lists pallets, client, SKU, lot and dimensions',
    /Pallets: 7/.test(mail.body) && /Client \/ brand: Camo Energy/.test(mail.body) && /6001390576/.test(mail.body) &&
    /lot 628290B/.test(mail.body) && /48 x 40 in footprint/.test(mail.body) && /2,000 lbs each/.test(mail.body), mail.body);

  // ── Export writes the stamp and checks it ─────────────────────────
  await page.evaluate(() => { document.querySelector('.wh-ov').remove(); window.__writes = []; });
  await page.click('[data-wh="tab"][data-arg="skus"]');
  await page.waitForSelector('[data-wh="exportSkus"]', { timeout: 5000 });
  await page.evaluate(() => { URL.createObjectURL = () => 'blob:x'; });
  await page.click('[data-wh="exportSkus"]');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 });
  const w = await page.evaluate(() => window.__writes);
  check('export stamps last_exported_at on the exported SKUs', w.length === 1 && w[0].table === 'wh_skus' && w[0].op === 'update' && !!w[0].payload.last_exported_at, JSON.stringify(w));

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
