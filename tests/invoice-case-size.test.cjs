/*
 * invoice-case-size.test.cjs — 12-count case trays change what a "case" is.
 *
 * The invoice builder hard-coded 24 cans per case. Ticking "12-count case
 * tray" only added a tray charge: the canning row still billed 24 cans per
 * case, showed cases × 24 cans, and the pallet count (cases ÷ cases per
 * pallet) was computed from 24-can cases, so entering trays-per-pallet gave
 * half the pallets.
 *
 * This loads the real page, opens the real builder with stubbed rates, and
 * checks the numbers a person sees.
 *
 *   NODE_PATH=/tmp/pw/node_modules node tests/invoice-case-size.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.CASE_SIZE_PORT || 8791);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

const failures = [];
function check(name, ok, detail) {
  if (ok) console.log(`  PASS: ${name}`);
  else { console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const r = await page.evaluate(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', is_admin: true, name: 'Test Admin' };
      // One flat rate so the expected numbers are easy to read: $0.50 a can.
      window._glR = { ok: true, b: [], c: [{ format: '12oz-standard', format_label: '12oz Standard', min_cases: 0, price_per_can: 0.5 }] };
      window.glLoadRates = async () => {};
      window.glGetClientOverride = () => null;
      window.openNewInvoiceBuilder();
      await wait(400);
      window.glAddLine('canning');
      await wait(100);
      const row = document.querySelector('#gl-inv-body [id$="-cases"]').closest('[data-gl-total]');
      const id = row.id;
      const casesEl = document.getElementById(id + '-cases');
      casesEl.value = '100';
      window.glUpdateCan(id);

      const box = (key) => document.querySelector('#gl-inv-addons input[data-addon="' + key + '"]');
      const addonQty = (key) => {
        const a = document.querySelector('#gl-inv-body [data-gl-addon="' + key + '"] [id$="-qty"]');
        return a ? Number(a.value) : null;
      };
      const snap = () => ({
        pcase: Number(document.getElementById(id + '-pcase').value),
        total: Number(row.getAttribute('data-gl-total')),
        cans: document.getElementById(id + '-cans').textContent,
      });

      const before = snap();

      // Tick 12-count trays, nitrogen (per can) and pallets; 40 trays a pallet.
      const tick = (key) => { const cb = box(key); cb.checked = true; cb.dispatchEvent(new Event('change')); };
      tick('tray12'); tick('nitrogen'); tick('pallet');
      const cpp = document.getElementById('gl-inv-addons-cpp');
      cpp.value = '40'; cpp.dispatchEvent(new Event('input'));
      const after = snap();
      const qty = { tray12: addonQty('tray12'), nitrogen: addonQty('nitrogen'), pallet: addonQty('pallet') };

      // A typed-over $/case keeps its per-can price when the case size changes.
      const pe = document.getElementById(id + '-pcase');
      pe.value = '7.20'; window.glUpdateCanPrice(id);        // $0.60/can at 12 a case
      const t12 = box('tray12'); t12.checked = false; t12.dispatchEvent(new Event('change'));
      const backTo24 = snap();

      // What gets saved for a 12-count row, and that it reopens the same.
      t12.checked = true; t12.dispatchEvent(new Event('change'));
      const pcase12 = Number(pe.value);
      return { before, after, qty, backTo24, pcase12, cpc: row.getAttribute('data-gl-cpc') };
    });

    check('24-can case by default: 100 cases × 24 × $0.50 = $1,200', r.before.total === 1200 && r.before.pcase === 12, JSON.stringify(r.before));
    check('12-count trays: $/case is 12 cans × $0.50 = $6.00', r.after.pcase === 6, JSON.stringify(r.after));
    check('12-count trays: 100 cases bill $600 for 1,200 cans', r.after.total === 600 && /1,200 cans/.test(r.after.cans), JSON.stringify(r.after));
    check('12-count tray add-on quantity is the number of cases (100)', r.qty.tray12 === 100, JSON.stringify(r.qty));
    check('per-can add-on counts real cans (1,200), not cases × 24', r.qty.nitrogen === 1200, JSON.stringify(r.qty));
    check('pallets: 100 trays ÷ 40 per pallet = 3', r.qty.pallet === 3, JSON.stringify(r.qty));
    check('typed $/case keeps its per-can price when switching back to 24 ($7.20 → $14.40)', r.backTo24.pcase === 14.4, JSON.stringify(r.backTo24));
    check('switching to 12 again halves it back to $7.20', r.pcase12 === 7.2 && r.cpc === '12', JSON.stringify(r));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
