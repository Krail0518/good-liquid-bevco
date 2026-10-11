/*
 * quote-case-size.test.cjs — 12-count case trays on a canning quote.
 *
 * The quote builder counted every case as 24 cans. Ticking "12-count Case
 * Tray" only added the tray charge: a 100-case tier still showed 2,400 cans and
 * billed fill and per-can add-ons on them. "Create Invoice" then carried those
 * 24-can numbers into the invoice.
 *
 * Checks the builder on screen, the line items a saved quote produces, and the
 * invoice those line items become.
 *
 *   NODE_PATH=/tmp/pw/node_modules node tests/quote-case-size.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.QUOTE_CASE_SIZE_PORT || 8792);
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
      const out = {};

      // 1) The builder on screen: canning → format → case tray. A 100-case
      //    tier, then pick the 12-count tray in the CASE TRAY picker.
      window.glOpenQuoteBuilder(null, null, { productType: 'canning', suggestCases: 100 });
      await wait(500);
      const cans = () => [...document.querySelectorAll('[data-tier-field="cans"]')].map((i) => Number(i.value));
      const cases = () => [...document.querySelectorAll('[data-tier-field="cases"]')].map((i) => Number(i.value));
      const t24 = () => document.getElementById('gl-qb-tray24-on');
      const t12 = () => document.getElementById('gl-qb-tray12-on');
      const pick = (v) => { const s = document.getElementById('gl-qb-tray'); s.value = v; s.dispatchEvent(new Event('change')); };
      out.cans24 = cans();
      out.pickerShown = getComputedStyle(document.getElementById('gl-qb-tray-wrap')).display !== 'none';
      pick('12');
      await wait(200);
      out.cans12 = cans(); out.cases12 = cases();
      out.ticks12 = { t12: t12().checked, t24: t24().checked };
      pick('24');
      await wait(200);
      out.cansBack = cans(); out.casesBack = cases();
      out.ticks24 = { t12: t12().checked, t24: t24().checked };
      // Ticking the 12-count tray charge by hand moves the picker too.
      const cb = t12(); cb.checked = true; cb.dispatchEvent(new Event('change'));
      await wait(200);
      out.pickerAfterTick = document.getElementById('gl-qb-tray').value;
      out.cansAfterTick = cans();
      const close = document.getElementById('gl-qb-close'); if (close) close.click();

      // 1b) The prices arrive late: the builder fetches them after opening and
      //     used to reset every add-on when they landed, undoing a tray picked
      //     in the meantime. Hold the fetch, pick 12-count, then let it finish.
      let release;
      const realLoad = window.glLoadPricingSettings;
      window.glLoadPricingSettings = () => new Promise((ok) => { release = ok; });
      window.glOpenQuoteBuilder(null, null, { productType: 'canning', suggestCases: 100 });
      await wait(400);
      pick('12');
      await wait(100);
      release();
      await wait(300);
      out.afterLatePrices = { picker: document.getElementById('gl-qb-tray').value, t12: t12().checked, t24: t24().checked, cans: cans() };
      window.glLoadPricingSettings = realLoad;
      const close2 = document.getElementById('gl-qb-close'); if (close2) close2.click();

      // 2) Line items from a saved 12-count quote.
      const data = { sections: [{ productType: 'canning', format: '12oz Standard',
        pkg: { tray12On: true, tray12PerCase: 0.5, tray24On: false, nitrogenOn: true, nitrogenPerCan: 0.03,
               palletOn: true, palletEach: 12, palletWrapOn: false, casesPerPallet: 40 },
        tiers: [{ cases: 100, cans: 1200, fillPerCan: 0.5 }] }] };
      const opt = window.glQuoteOptions(data)[0];
      const find = (pred) => opt.items.find(pred) || {};
      out.fill = find((l) => l.kind === 'canning');
      out.tray = find((l) => l.addon === 'tray12');
      out.nitro = find((l) => l.addon === 'nitrogen');
      out.pallet = find((l) => l.addon === 'pallet');

      // 3) "Create Invoice" from that option keeps the 12-can case.
      window._glR = { ok: true, b: [], c: [{ format: '12oz-standard', format_label: '12oz Standard', min_cases: 0, price_per_can: 0.5 }] };
      window.glLoadRates = async () => {};
      window.glGetClientOverride = () => null;
      await window.glInvoiceFromQuote({ clientId: null, quoteNumber: 'Q-TEST', items: opt.items, casesPerPallet: 40 });
      await wait(300);
      const row = document.querySelector('#gl-inv-body [id$="-cases"]').closest('[data-gl-total]');
      out.inv = {
        cpc: row.getAttribute('data-gl-cpc'),
        trayPicker: document.getElementById(row.id + '-tray').value,
        total: Number(row.getAttribute('data-gl-total')),
        cansPerCaseNow: window.glInvCansPerCase(),
      };
      return out;
    });

    check('quote: 100 cases are 2,400 cans with 24-count trays', r.cans24[0] === 2400, JSON.stringify(r.cans24));
    check('quote: the CASE TRAY picker shows for canning', r.pickerShown);
    check('quote: picking 12-count keeps 2,400 cans as 200 cases', r.cases12[0] === 200 && r.cans12[0] === 2400, JSON.stringify([r.cases12, r.cans12]));
    check('quote: picking 12-count ticks its tray charge and unticks 24-count', r.ticks12.t12 && !r.ticks12.t24, JSON.stringify(r.ticks12));
    check('quote: picking 24-count goes back to 100 cases and swaps the charge', r.casesBack[0] === 100 && r.cansBack[0] === 2400 && r.ticks24.t24 && !r.ticks24.t12, JSON.stringify([r.casesBack, r.cansBack, r.ticks24]));
    check('quote: ticking the 12-count tray charge moves the picker to 12, cans unchanged', r.pickerAfterTick === '12' && r.cansAfterTick[0] === 2400, JSON.stringify([r.pickerAfterTick, r.cansAfterTick]));
    check('quote: a tray picked before the prices load is kept when they arrive', r.afterLatePrices.picker === '12' && r.afterLatePrices.t12 && !r.afterLatePrices.t24 && r.afterLatePrices.cans[0] === 2400, JSON.stringify(r.afterLatePrices));
    check('quote line: canning is 100 cases at $6.00 (12 × $0.50)', r.fill.qty === 100 && r.fill.unitPrice === 6 && r.fill.cansPerCase === 12, JSON.stringify(r.fill));
    check('quote line: 12-count tray × 100 cases', r.tray.qty === 100, JSON.stringify(r.tray));
    check('quote line: nitrogen on 1,200 cans', r.nitro.qty === 1200, JSON.stringify(r.nitro));
    check('quote line: 100 cases ÷ 40 per pallet = 3 pallets', r.pallet.qty === 3, JSON.stringify(r.pallet));
    check('invoice from quote: canning row is 12-can cases billing $600', r.inv.cpc === '12' && r.inv.total === 600, JSON.stringify(r.inv));
    check('invoice from quote: the line\'s case tray picker reads 12-count', r.inv.trayPicker === '12', JSON.stringify(r.inv));
    check('invoice from quote: a new line would start on 12-count', r.inv.cansPerCaseNow === 12, JSON.stringify(r.inv));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
