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
 *   - BOL pallet sheets: a 14-pallet BOL prints 14 sheets, 1 OF 14 .. 14 OF 14
 *   - BOL upload: the file goes to ai-proxy as a document/image block, the
 *     reply fills the form, script inside a BOL stays text, failures explain
 *   - pallet notes: typed in quick build, shown on the transfer, the dashboard
 *     and pick list, edited per pallet, printed on the packing list and label,
 *     listed in the scheduling email; script in a note stays text
 *   - Good Liquid's own packaging (client_id null): shown under its own owner
 *     on the dashboard, a packaging transfer prints its packing list and
 *     labels, new transfers and SKUs send client_id null, and Good Liquid
 *     cannot be picked for a finished-goods move
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
  current_transfer_id: T1.id, received_at_conri: null, expected_pull_date: null, notes: i === 2 ? 'Shrink wrap torn, rewrapped' : null, sku: SKU, lot: LOT, line_no: i }));

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
    received_at_conri: threeDaysAgo, expected_pull_date: isoDaysFromNow(-1), sku: SKU_CANS, lot: null, notes: 'Back for Camo run ' + XSS },
  { id: 'q-4', pallet_tag: 'GL-P-000104', cases: 10, location: 'conri', status: 'stored', current_transfer_id: null,
    received_at_conri: '2026-09-20T12:00:00Z', sku: SKU_EVIL, lot: null },
];

// Good Liquid's own packaging: no client anywhere.
const SKU_TRAY = { id: 's-tray', client_id: null, client: null, upc_sku: 'TRAY12SLIM-1800', description: '12 ct Carrier Tray, Slim Cans ' + XSS,
  brand: null, pack: '150/cs', units_per_case: 150, default_cases_per_pallet: null, default_pallet_weight_lbs: null,
  default_pallet_height_in: null, inventory_type: 'packaging', active: true, notes: null, last_exported_at: null };
const T2 = { id: 't-2', transfer_number: 'GL-TR-20261008-01', type: 'to_conri_packaging', transfer_date: '2026-10-08', status: 'draft',
  scheduled_at: null, client_id: null, client: null, carrier: null, ship_to: null, conri_confirmation: null, released_by: 'Mike Krail', notes: null };
// An empty-can move for a client with no empty-can item yet.
const T3 = { id: 't-3', transfer_number: 'GL-TR-20261008-02', type: 'to_conri_overflow', transfer_date: '2026-10-08', status: 'draft',
  scheduled_at: null, client_id: EVIL.id, client: EVIL, carrier: null, ship_to: null, conri_confirmation: null, released_by: 'Mike Krail', notes: null };
const TRAY_PALLET = { id: 'p-tray', pallet_tag: 'GL-P-000200', cases: 2, weight_lbs: 300, height_in: 60, location: 'good_liquid', status: 'staged',
  current_transfer_id: T2.id, received_at_conri: null, expected_pull_date: null, notes: null, sku: SKU_TRAY, lot: null, line_no: 1 };
CONRI_PALLETS.push({ id: 'q-5', pallet_tag: 'GL-P-000105', cases: 4, location: 'conri', status: 'stored', current_transfer_id: null,
  received_at_conri: '2026-10-01T12:00:00Z', sku: SKU_TRAY, lot: null });

const FIX = {
  clients: [CAMO, EVIL],
  wh_transfers: [T1, T2, T3],
  wh_transfer_lines: SEED_PALLETS.map((p) => ({ transfer_id: T1.id, line_no: p.line_no, pallet: p }))
    .concat([{ transfer_id: T2.id, line_no: 1, pallet: TRAY_PALLET }]),
  wh_pallets: SEED_PALLETS.concat(CONRI_PALLETS, [TRAY_PALLET]),
  wh_movements: [],
  wh_outbound_orders: [],
  wh_skus: [SKU, SKU_SOON, SKU_CANS, SKU_TRAY],
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
  delete: function(){ return new Q(t, 'delete'); } }; },
  functions: { invoke: function(name, opts){
    window.__aiCalls = (window.__aiCalls || []).concat([{ name: name, body: opts && opts.body }]);
    return Promise.resolve(window.__aiReply || { data: { ok: false, error: 'no stub reply' }, error: null });
  } } };
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
  check('the link is hidden until an admin or sales user logs in', /display:none/.test(nav), nav);
  check('the link routes through cNav to the warehouse page', /data-gl-action="cNav"/.test(nav) && /data-gl-arg1="warehouse"/.test(nav));
  check('the page has a mount point', /<div id="cpg-warehouse" class="cpg"><\/div>/.test(html));
  check('the module is loaded as a classic root-absolute script',
    /<script src="\/src\/modules\/warehouse\/warehouse\.js"><\/script>/.test(html));
  const auth = fs.readFileSync(path.join(ROOT, 'src/services/auth.js'), 'utf8');
  check('admin and sales login reveal the link, unless unticked for that user',
    /if\(\(u\.role==='admin'\|\|u\.role==='sales'\)&&\(typeof window\.glCan!=='function'\|\|window\.glCan\('page\.warehouse'\)\)\)\{var nw=\$\('nav-warehouse'\)/.test(auth));
  const perms = fs.readFileSync(path.join(ROOT, 'src/services/permissions-service.js'), 'utf8');
  const salesLists = perms.match(/sales:\s*\[[^\]]*\]|PERMISSIONS\.sales=\[[^\]]*\]/g) || [];
  check('sales may open the warehouse page (both sales page lists)',
    salesLists.length === 2 && salesLists.every((l) => /'warehouse'/.test(l)), JSON.stringify(salesLists));
  check('warehouse role and viewer still may not',
    !/var WAREHOUSE=\[[^\]]*'warehouse'/.test(perms) && !/viewer:\[[^\]]*'warehouse'/.test(perms));

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
  check('dashboard totals pallets at CONRI', /PALLETS AT CONRI\s*5/.test(dash.text), dash.text.slice(0, 200));
  check('Good Liquid packaging is grouped under its own owner, not "unknown client"',
    /Good Liquid \(own packaging\)/.test(dash.text) && /TRAY12SLIM-1800/.test(dash.text) && /\(packaging\)/.test(dash.text) && !/unknown client/.test(dash.text), dash.text);
  check('empty cans past 2 days are flagged red', dash.redRows.some((r) => /GL-P-000103/.test(r) && /3 days/.test(r)), JSON.stringify(dash.redRows));
  check('a finished lot under 90 days to best by is flagged yellow', dash.yellowRows.some((r) => /SOON1/.test(r)), JSON.stringify(dash.yellowRows));
  check('a lot 300 days out is not flagged', !dash.yellowRows.some((r) => /LATER1/.test(r)));
  check('script in a client name / SKU description does not run', !dash.xss);
  check('the escaped payload is shown as text', /<img src=x/.test(dash.text));
  check('dashboard lists pallet notes at CONRI (empties table and notes card)',
    /Pallet notes at CONRI/.test(dash.text) && (dash.text.match(/Back for Camo run/g) || []).length === 2, dash.text);

  // ── Transfers list -> detail ──────────────────────────────────────
  await page.click('[data-wh="tab"][data-arg="transfers"]');
  await page.waitForSelector('[data-wh="openTransfer"]', { timeout: 5000 });
  const listRow = await page.evaluate(() => document.querySelector('[data-wh="openTransfer"][data-arg="t-1"]').innerText);
  check('transfer list shows the seeded transfer with 7 pallets, 1,400 cases',
    /GL-TR-20260930-01/.test(listRow) && /\b7\b/.test(listRow) && /1,400/.test(listRow), listRow);
  const glRow = await page.evaluate(() => document.querySelector('[data-wh="openTransfer"][data-arg="t-2"]').innerText);
  check('a packaging transfer lists Good Liquid as the owner', /To CONRI: Good Liquid packaging/.test(glRow) && /Good Liquid \(own packaging\)/.test(glRow), glRow);
  await page.click('[data-wh="openTransfer"][data-arg="t-1"]');
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
  check('detail shows the pallet note and a way to add one', /Shrink wrap torn, rewrapped/.test(detail.text) && /\+ Note/.test(detail.text));

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
    check('the note prints under its packing-list row and on its label', has('Note: Shrink wrap torn, rewrapped') && has('NOTE') && /\(Shrink wrap torn, rewrapped\)/.test(pdf.raw));
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
      upc10: I.upcWarning('6001390576'), upc12: I.upcWarning('012345678905'), pkgUpc: I.upcWarning('TRAY12-1800', 'packaging'),
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
  check('a packaging item number is not warned about as a short UPC', pure.pkgUpc === '', pure.pkgUpc);
  check('date-only values are not shifted by timezone', pure.date === '09/30/2026');

  // ── Scheduling email ──────────────────────────────────────────────
  await page.click('[data-wh="schedEmail"]');
  await page.waitForSelector('#wem-body', { timeout: 5000 });
  const mail = await page.evaluate(() => ({ body: document.getElementById('wem-body').value, href: document.getElementById('wem-open').getAttribute('href') }));
  check('scheduling email goes to CONRI', /^mailto:pnolletti%40conriservices\.com\?subject=/.test(mail.href), mail.href.slice(0, 80));
  check('email lists pallets, client, SKU, lot and dimensions',
    /Pallets: 7/.test(mail.body) && /Client \/ brand: Camo Energy/.test(mail.body) && /6001390576/.test(mail.body) &&
    /lot 628290B/.test(mail.body) && /48 x 40 in footprint/.test(mail.body) && /2,000 lbs each/.test(mail.body), mail.body);
  check('email lists pallet notes for CONRI', /Pallet notes:\n  - GL-P-000002: Shrink wrap torn, rewrapped/.test(mail.body), mail.body);

  // Edit one pallet's note: the write is checked and goes to that pallet only.
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); window.__writes = []; });
  await page.click('[data-wh="editPalletNote"][data-arg="p-2"]');
  await page.waitForSelector('#wpn-note', { timeout: 5000 });
  const before = await page.evaluate(() => document.getElementById('wpn-note').value);
  check('the note editor opens with the current note', before === 'Shrink wrap torn, rewrapped', before);
  await page.fill('#wpn-note', '  Rewrapped by Mike ' + XSS + '  ');
  await page.click('#wpn-save');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 });
  const nw = await page.evaluate(() => window.__writes[0]);
  check('saving a note updates only that pallet, trimmed', nw.table === 'wh_pallets' && nw.op === 'update' &&
    nw.payload.notes === 'Rewrapped by Mike ' + XSS && JSON.stringify(nw.filters) === JSON.stringify([['id', 'p-2']]), JSON.stringify(nw));

  // ── Export writes the stamp and checks it ─────────────────────────
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); window.__writes = []; });
  await page.click('[data-wh="tab"][data-arg="skus"]');
  await page.waitForSelector('[data-wh="exportSkus"]', { timeout: 5000 });
  await page.evaluate(() => { URL.createObjectURL = () => 'blob:x'; });
  await page.click('[data-wh="exportSkus"]');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 });
  const w = await page.evaluate(() => window.__writes);
  check('export stamps last_exported_at on the exported SKUs', w.length === 1 && w[0].table === 'wh_skus' && w[0].op === 'update' && !!w[0].payload.last_exported_at, JSON.stringify(w));

  // ── BOL pallet sheets ─────────────────────────────────────────────
  const bolPure = await page.evaluate(() => {
    const B = window.glWhInternals.bolInput;
    return {
      ok: B({ bol: 'BOL-77', pallets: '14', cases: '120' }),
      noBol: B({ pallets: '3' }).errors.length,
      zero: B({ bol: 'X', pallets: '0' }).errors.length,
      frac: B({ bol: 'X', pallets: '2.5' }).errors.length,
      huge: B({ bol: 'X', pallets: '5000' }).errors.length,
    };
  });
  check('BOL input: 14 pallets parses, no errors', bolPure.ok.errors.length === 0 && bolPure.ok.info.pallets === 14 && bolPure.ok.info.cases === 120, JSON.stringify(bolPure.ok));
  check('BOL input: missing BOL #, 0, fractional and absurd counts are refused',
    bolPure.noBol === 1 && bolPure.zero === 1 && bolPure.frac === 1 && bolPure.huge === 1, JSON.stringify(bolPure));

  await page.click('[data-wh="tab"][data-arg="bol"]');
  await page.waitForSelector('#wh-bol-bol', { timeout: 5000 });
  await page.click('[data-wh="printBolSheets"]');
  const bolErr = await page.evaluate(() => document.getElementById('wh-bol-msg').innerText);
  check('printing with an empty form says what is missing', /BOL number/.test(bolErr) && /how many pallets/.test(bolErr), bolErr);
  await page.fill('#wh-bol-bol', 'BOL-55821');
  await page.fill('#wh-bol-pallets', '14');
  await page.fill('#wh-bol-client', XSS);
  await page.fill('#wh-bol-po', 'PO-9001');
  await page.fill('#wh-bol-carrier', 'XPO Logistics');
  await page.fill('#wh-bol-shipto', 'Publix DC\n1936 George Jenkins Blvd\nLakeland, FL 33815');
  await page.fill('#wh-bol-cases', '120');
  const btnText = await page.evaluate(() => document.getElementById('wh-bol-print').textContent);
  check('the print button counts the sheets as you type', /Print 14 pallet sheets/.test(btnText), btnText);
  // Switching tabs and back keeps what was typed.
  await page.click('[data-wh="tab"][data-arg="recon"]');
  await page.click('[data-wh="tab"][data-arg="bol"]');
  await page.waitForSelector('#wh-bol-bol', { timeout: 5000 });
  const kept = await page.evaluate(() => ({ bol: document.getElementById('wh-bol-bol').value, client: document.getElementById('wh-bol-client').value,
    xss: window.__xss === 1 || !!document.querySelector('#wh-body img') }));
  check('the BOL form survives a tab switch', kept.bol === 'BOL-55821' && kept.client === XSS, JSON.stringify(kept));
  check('script typed into the BOL form does not run', !kept.xss);
  if (JSPDF) {
    await page.evaluate(() => { window.__savedName = null; window.__savedPdf = null; });
    await page.click('[data-wh="printBolSheets"]');
    await page.waitForFunction(() => !!window.__savedName, null, { timeout: 8000 });
    const bol = await page.evaluate(() => ({ name: window.__savedName, raw: window.__savedPdf }));
    const bpages = (bol.raw.match(/\/Type \/Page\b/g) || []).length;
    const bhas = (s) => bol.raw.indexOf('(' + s) >= 0;
    check('BOL PDF is named for the BOL', bol.name === 'BOL_BOL-55821_pallet_sheets.pdf', bol.name);
    check('BOL PDF has one sheet per pallet: 14 pages', bpages === 14, 'pages=' + bpages);
    check('sheets run 1 OF 14 through 14 OF 14', bhas('1 OF 14') && bhas('7 OF 14') && bhas('14 OF 14') && !bhas('15 OF 14'));
    check('sheets carry BOL, PO, carrier, ship to, cases',
      bhas('BOL-55821') && bhas('PO-9001') && bhas('XPO Logistics') && bhas('Publix DC') && bhas('Lakeland, FL 33815') && bhas('120'));
    if (process.env.WH_BOL_OUT) fs.writeFileSync(process.env.WH_BOL_OUT, Buffer.from(bol.raw, 'binary'));
  }

  // ── BOL upload, read by AI ────────────────────────────────────────
  const aiPure = await page.evaluate(() => {
    const F = window.glWhInternals.bolFromAi;
    const ok = F('Here you go:\n```json\n{"bol_number":"BOL-9","po_number":"PO-1","ship_date":"2026-10-07","carrier":"XPO","shipper":"CAMO ENERGY LLC c/o CONRI","consignee":"Publix","ship_to":"Publix DC\\nLakeland, FL","product":"Glow 12oz","lot":"628290B","pallet_count":14,"cases_per_pallet":120}\n```', ['Camo Energy', 'Evil']);
    const bad = F('{"bol_number":"X","pallet_count":"lots","ship_date":"Oct 7","cases_per_pallet":2.5,"shipper":{"x":1}}', []);
    let thrown = '';
    try { F('Sorry, I cannot read that.', []); } catch (e) { thrown = e.message; }
    return { ok, bad, thrown };
  });
  check('AI reply: JSON is found inside surrounding text and fenced code',
    aiPure.ok.bol === 'BOL-9' && aiPure.ok.pallets === '14' && aiPure.ok.cases === '120' && aiPure.ok.date === '2026-10-07' && aiPure.ok.shipto === 'Publix DC\nLakeland, FL', JSON.stringify(aiPure.ok));
  check('AI reply: the shipper is matched to our client name', aiPure.ok.client === 'Camo Energy', aiPure.ok.client);
  check('AI reply: a non-number pallet count, a loose date, a fractional case count and an object are dropped',
    aiPure.bad.pallets === '' && aiPure.bad.date === '' && aiPure.bad.cases === '' && aiPure.bad.client === '', JSON.stringify(aiPure.bad));
  check('AI reply without JSON is an error, not empty fields', /did not return/.test(aiPure.thrown), aiPure.thrown);

  await page.click('[data-wh="clearBol"]');
  await page.evaluate((xss) => {
    window.__aiCalls = [];
    window.__aiReply = { error: null, data: { ok: true, text: JSON.stringify({
      bol_number: 'BOL-77001', po_number: 'PO-555', ship_date: '2026-10-09', carrier: 'Estes',
      shipper: 'Camo Energy', consignee: 'Kroger', ship_to: 'Kroger DC ' + xss + '\n100 Main St',
      product: 'Glow ' + xss, lot: 'L1', pallet_count: 9, cases_per_pallet: 80 }) } };
  }, XSS);
  await page.setInputFiles('#wh-bol-file', { name: 'bol.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
  await page.waitForFunction(() => /Filled \d+ fields/.test((document.getElementById('wh-bol-msg') || {}).innerText || ''), null, { timeout: 5000 });
  const up = await page.evaluate(() => {
    const c = window.__aiCalls[0] || {};
    const content = (((c.body || {}).messages || [])[0] || {}).content || [];
    return {
      fn: c.name, model: (c.body || {}).model, block: content[0] && { type: content[0].type, media: content[0].source.media_type, data: content[0].source.data },
      hasPrompt: !!(content[1] && /bill of lading/.test(content[1].text)),
      bol: document.getElementById('wh-bol-bol').value, pallets: document.getElementById('wh-bol-pallets').value,
      client: document.getElementById('wh-bol-client').value, shipto: document.getElementById('wh-bol-shipto').value,
      product: document.getElementById('wh-bol-product').value, date: document.getElementById('wh-bol-date').value,
      btn: document.getElementById('wh-bol-print').textContent, msg: document.getElementById('wh-bol-msg').innerText,
      outlined: /box-shadow:0 0 0 1px var\(--teal\)/.test(document.getElementById('wh-bol-bol').getAttribute('style') || ''),
      xss: window.__xss === 1 || !!document.querySelector('#wh-body img'),
    };
  });
  check('upload sends the PDF to ai-proxy as a base64 document block with the extraction prompt',
    up.fn === 'ai-proxy' && up.model === 'claude-opus-5-5' && up.block && up.block.type === 'document' && up.block.media === 'application/pdf' &&
    Buffer.from(up.block.data, 'base64').toString() === '%PDF-1.4 fake' && up.hasPrompt, JSON.stringify(up).slice(0, 300));
  check('the BOL fields are filled from the reply', up.bol === 'BOL-77001' && up.pallets === '9' && up.client === 'Camo Energy' && up.date === '2026-10-09' && /100 Main St/.test(up.shipto), JSON.stringify(up));
  check('the print button reflects the read pallet count', /Print 9 pallet sheets/.test(up.btn), up.btn);
  check('filled fields are outlined and the note says to check them', up.outlined && /Check them against the BOL/.test(up.msg), up.msg);
  check('script inside a BOL does not run; it stays text in the field', !up.xss && up.product.indexOf('<img') >= 0);

  // A failed read leaves what was there and says so.
  await page.evaluate(() => { window.__aiReply = { error: null, data: { ok: false, error: 'Rate limit reached' } }; });
  await page.setInputFiles('#wh-bol-file', { name: 'bol2.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
  await page.waitForFunction(() => /Could not read the BOL/.test((document.getElementById('wh-bol-msg') || {}).innerText || ''), null, { timeout: 5000 });
  const fail = await page.evaluate(() => ({ bol: document.getElementById('wh-bol-bol').value, msg: document.getElementById('wh-bol-msg').innerText,
    type: ((((window.__aiCalls[1] || {}).body || {}).messages || [])[0] || {}).content[0].type }));
  check('a photo is sent as an image block', fail.type === 'image', fail.type);
  check('a failed read keeps the fields and explains', fail.bol === 'BOL-77001' && /Rate limit reached/.test(fail.msg) && /type it in/.test(fail.msg), JSON.stringify(fail));
  await page.evaluate(() => { window.__aiCalls = []; });
  await page.setInputFiles('#wh-bol-file', { name: 'bol.docx', mimeType: 'application/msword', buffer: Buffer.from('x') });
  const wrong = await page.evaluate(() => ({ msg: document.getElementById('wh-bol-msg').innerText, calls: window.__aiCalls.length }));
  check('a Word file is refused before anything is sent', /Upload a PDF, JPG or PNG/.test(wrong.msg) && wrong.calls === 0, JSON.stringify(wrong));

  // ── Good Liquid packaging ─────────────────────────────────────────
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); });
  await page.click('[data-wh="tab"][data-arg="transfers"]');
  await page.waitForSelector('[data-wh="openTransfer"][data-arg="t-2"]', { timeout: 5000 });
  await page.click('[data-wh="openTransfer"][data-arg="t-2"]');
  await page.waitForSelector('[data-wh="printPaperwork"]', { timeout: 5000 });
  const pk = await page.evaluate(() => ({
    text: document.getElementById('wh-body').innerText,
    schedDisabled: !!(document.querySelector('[data-wh="scheduleTransfer"]') || {}).disabled,
    quick: !!document.querySelector('[data-wh="quickBuild"]'),
    xss: window.__xss === 1 || !!document.querySelector('#wh-body img'),
  }));
  check('packaging transfer detail names the move and the owner',
    /To CONRI: Good Liquid packaging · Good Liquid \(own packaging\)/.test(pk.text), pk.text.slice(0, 300));
  check('packaging is inbound: quick build is offered', pk.quick);
  check('a packaging SKU never exported to CONRI blocks scheduling', pk.schedDisabled && /TRAY12SLIM-1800 has never been exported/.test(pk.text));
  check('no UPC-length warning on a packaging item number', !/UPC has \d+ digits/.test(pk.text), pk.text.slice(0, 400));
  check('script in a packaging description does not run', !pk.xss);
  if (JSPDF) {
    await page.evaluate(() => { window.__savedName = null; window.__savedPdf = null; });
    await page.click('[data-wh="printPaperwork"]');
    await page.waitForFunction(() => !!window.__savedName, null, { timeout: 8000 });
    const ppdf = await page.evaluate(() => ({ name: window.__savedName, raw: window.__savedPdf }));
    const phas = (x) => ppdf.raw.indexOf('(' + x) >= 0;
    check('packaging PDF: packing list + 1 label', (ppdf.raw.match(/\/Type \/Page\b/g) || []).length === 2 && ppdf.name === 'GL-TR-20261008-01_paperwork.pdf', ppdf.name);
    check('packaging PDF: owner, move, storage note, item and label banner',
      phas('Good Liquid \\(own packaging\\)') && phas('To CONRI: Good Liquid packaging') && phas('Storage: Good Liquid packaging supplies') &&
      phas('TRAY12SLIM-1800') && phas('PACKAGING SUPPLIES  |  PROPERTY OF GOOD LIQUID BEV CO') && phas('1/1'));
    if (process.env.WH_PKG_OUT) fs.writeFileSync(process.env.WH_PKG_OUT, Buffer.from(ppdf.raw, 'binary'));
  }

  // Quick build: the client is named, and the note goes on every pallet.
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); window.__writes = []; });
  await page.click('[data-wh="quickBuild"]');
  await page.waitForSelector('#wqb-note', { timeout: 5000 });
  const qbHead = await page.evaluate(() => document.querySelector('.wh-ov').innerText);
  check('quick build names the client the pallets belong to', /Client: Good Liquid \(own packaging\)/.test(qbHead), qbHead.slice(0, 120));
  await page.fill('#wqb-count', '2');
  await page.fill('#wqb-cases', '3');
  await page.fill('#wqb-note', 'From Pak-it, invoice 477256');
  await page.click('#wqb-save');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'wh_pallets'), null, { timeout: 5000 });
  const qbw = await page.evaluate(() => window.__writes.find((w) => w.table === 'wh_pallets'));
  check('quick build writes the note on every pallet it creates', Array.isArray(qbw.payload) && qbw.payload.length === 2 &&
    qbw.payload.every((r) => r.notes === 'From Pak-it, invoice 477256'), JSON.stringify(qbw));

  // A client with no item of this kind: quick build offers to add one, for that client.
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); });
  await page.click('[data-wh="tab"][data-arg="transfers"]');
  await page.waitForSelector('[data-wh="openTransfer"][data-arg="t-3"]', { timeout: 5000 });
  await page.click('[data-wh="openTransfer"][data-arg="t-3"]');
  await page.waitForSelector('[data-wh="quickBuild"]', { timeout: 5000 });
  await page.click('[data-wh="quickBuild"]');
  await page.waitForSelector('#wqb-newsku', { timeout: 5000 });
  const ns = await page.evaluate(() => ({ text: document.querySelector('.wh-ov').innerText, xss: window.__xss === 1 || !!document.querySelector('.wh-ov img') }));
  check('no item yet: quick build offers to add one for that client', /no empty cans items yet/.test(ns.text) && /\+ New empty cans item for Evil/.test(ns.text), ns.text);
  check('a client name with script stays text in that offer', !ns.xss);
  await page.click('#wqb-newsku');
  await page.waitForSelector('#ws-client', { timeout: 5000 });
  const pre = await page.evaluate(() => ({ owner: document.getElementById('ws-client').value, type: document.getElementById('ws-type').value }));
  check('the new item form opens for that client, as empty cans', pre.owner === 'c-evil' && pre.type === 'empty_can', JSON.stringify(pre));
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); });

  // New transfer: packaging forces Good Liquid and sends client_id null.
  await page.evaluate(() => { window.__writes = []; });
  await page.click('[data-wh="newTransfer"]');
  await page.waitForSelector('#wnt-type', { timeout: 5000 });
  await page.selectOption('#wnt-type', 'to_conri_packaging');
  const owner = await page.evaluate(() => ({ v: document.getElementById('wnt-client').value, dis: document.getElementById('wnt-client').disabled }));
  check('choosing a packaging transfer sets the owner to Good Liquid and locks it', owner.v === '__gl__' && owner.dis, JSON.stringify(owner));
  await page.click('#wnt-save');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 });
  const ntw = await page.evaluate(() => window.__writes[0]);
  check('the packaging transfer is inserted with client_id null', ntw.table === 'wh_transfers' && ntw.op === 'insert' &&
    ntw.payload.type === 'to_conri_packaging' && ntw.payload.client_id === null && ntw.payload.released_by === 'Test Admin', JSON.stringify(ntw));

  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); window.__writes = []; });
  await page.click('[data-wh="newTransfer"]');
  await page.waitForSelector('#wnt-type', { timeout: 5000 });
  await page.selectOption('#wnt-type', 'to_conri_finished');
  await page.selectOption('#wnt-client', '__gl__');
  await page.click('#wnt-save');
  const refused = await page.evaluate(() => ({ msg: document.querySelector('.wh-ov-msg').innerText, writes: window.__writes.length }));
  check('Good Liquid cannot be the owner of a finished-goods move', /only go to CONRI as packaging/.test(refused.msg) && refused.writes === 0, JSON.stringify(refused));

  // New SKU: picking Good Liquid makes it packaging, and the insert has no client.
  await page.evaluate(() => { document.querySelectorAll('.wh-ov').forEach((o) => o.remove()); window.__writes = []; });
  await page.click('[data-wh="tab"][data-arg="skus"]');
  await page.waitForSelector('[data-wh="newSku"]', { timeout: 5000 });
  const skuList = await page.evaluate(() => document.getElementById('wh-body').innerText);
  check('SKU master shows the packaging type', /TRAY12SLIM-1800/.test(skuList) && /Packaging/.test(skuList));
  await page.click('[data-wh="newSku"]');
  await page.waitForSelector('#ws-client', { timeout: 5000 });
  await page.selectOption('#ws-client', '__gl__');
  const t1 = await page.evaluate(() => document.getElementById('ws-type').value);
  check('choosing Good Liquid as owner sets the type to Packaging', t1 === 'packaging', t1);
  await page.selectOption('#ws-type', 'finished_good');
  const o2 = await page.evaluate(() => document.getElementById('ws-client').value);
  check('choosing a client type clears the Good Liquid owner', o2 === '', o2);
  await page.selectOption('#ws-type', 'packaging');
  await page.fill('#ws-upc', 'TRAY24-600');
  await page.fill('#ws-desc', '24 ct Carrier Tray, Standard Cans');
  await page.click('#ws-save');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 });
  const nsw = await page.evaluate(() => window.__writes[0]);
  check('the packaging SKU is inserted with client_id null', nsw.table === 'wh_skus' && nsw.op === 'insert' &&
    nsw.payload.client_id === null && nsw.payload.inventory_type === 'packaging', JSON.stringify(nsw));

  const pcsv = await page.evaluate(() => window.glWhInternals.skuCsv([{ upc_sku: 'TRAY24-600', description: '24 ct tray', client: null,
    units_per_case: 150, inventory_type: 'packaging' }]).split('\r\n')[1]);
  check('CONRI CSV labels packaging and names Good Liquid as the customer', pcsv === 'TRAY24-600,24 ct tray,Good Liquid Bev Co,150,,,Packaging', pcsv);

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
