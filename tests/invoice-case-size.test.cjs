/*
 * invoice-case-size.test.cjs — the case tray on a canning line.
 *
 * The invoice builder hard-coded 24 cans per case, so 880 cases packed in
 * 12-count trays were billed as 21,120 cans, and the pallet count was worked
 * out from the wrong number of cases. Each canning line now has its own case
 * tray picker under the format (canning → format → case tray). Changing the
 * tray keeps the cans and converts the cases (200 of 24 = 400 of 12, 4,800
 * cans either way); cases typed after picking the tray are cases of that
 * tray (880 on 12-count = 10,560 cans). Price per case, the tray charge,
 * per-can add-ons and pallets all follow.
 *
 * This loads the real page, opens the real builder with stubbed rates, and
 * drives it the way a person does: type the cases, pick the tray.
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    // One flat rate so the expected numbers are easy to read: $0.50 a can.
    const id = await page.evaluate(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', is_admin: true, name: 'Test Admin' };
      window._glR = { ok: true, b: [], c: [{ format: '12oz-standard', format_label: '12oz Standard', min_cases: 0, price_per_can: 0.5 }] };
      window.glLoadRates = async () => {};
      window.glGetClientOverride = () => null;
      window.openNewInvoiceBuilder();
      await wait(400);
      window.glAddLine('canning');
      await wait(100);
      return document.querySelector('#gl-inv-body [id$="-cases"]').closest('[data-gl-total]').id;
    });

    const snap = () => page.evaluate((id) => {
      const qty = (key) => {
        const a = document.querySelector('#gl-inv-body [data-gl-addon="' + key + '"] [id$="-qty"]');
        return a ? Number(a.value) : null;
      };
      const row = document.getElementById(id);
      return {
        cases: Number(document.getElementById(id + '-cases').value),
        cans: document.getElementById(id + '-cans').textContent,
        pcase: Number(document.getElementById(id + '-pcase').value),
        total: Number(row.getAttribute('data-gl-total')),
        tray: document.getElementById(id + '-tray').value,
        tray12: qty('tray12'), tray24: qty('tray24'), nitrogen: qty('nitrogen'), pallet: qty('pallet'),
      };
    }, id);
    const typeCases = async (n) => {
      await page.fill(`#${id}-cases`, String(n));
      await page.press(`#${id}-cases`, 'Tab');
      await page.waitForTimeout(100);
    };

    // A new line: 200 cases of 24 = 4,800 cans. Nitrogen and pallets ticked,
    // 208 cases a pallet.
    await page.click('#gl-inv-addons input[data-addon="nitrogen"]');
    await page.click('#gl-inv-addons input[data-addon="pallet"]');
    await page.fill('#gl-inv-addons-cpp', '208');
    const on24 = await snap();

    // Pick the 12-count case tray: same 4,800 cans, 400 cases.
    await page.selectOption(`#${id}-tray`, '12');
    await page.waitForTimeout(150);
    const switched = await snap();

    // Now type the run in 12-count cases.
    await typeCases(880);
    const on12 = await snap();

    // The run from the pallet question: 31,680 cans = 2,640 cases of 12.
    await typeCases(2640);
    const big = await snap();

    // A typed-over $/case keeps its per-can price when the tray changes.
    await page.fill(`#${id}-pcase`, '7.20');
    await page.press(`#${id}-pcase`, 'Tab');
    await page.selectOption(`#${id}-tray`, '24');
    await page.waitForTimeout(150);
    const back24 = await snap();

    // A second canning line starts on the tray the last one is on.
    await page.selectOption(`#${id}-tray`, '12');
    const second = await page.evaluate(async () => {
      window.glAddLine('canning');
      await new Promise((ok) => setTimeout(ok, 100));
      const trays = [...document.querySelectorAll('#gl-inv-body [id$="-tray"]')];
      return trays[trays.length - 1].value;
    });

    check('new line: 200 cases of 24 = 4,800 cans at $12.00 a case', on24.cases === 200 && /4,800 cans/.test(on24.cans) && on24.pcase === 12, JSON.stringify(on24));
    check('12-count tray: same 4,800 cans, cases double to 400', switched.cases === 400 && /4,800 cans/.test(switched.cans), JSON.stringify(switched));
    check('12-count tray: switching leaves the line total at $2,400', switched.total === 2400 && switched.pcase === 6, JSON.stringify(switched));
    check('12-count tray: 880 cases typed are 10,560 cans', on12.cases === 880 && /10,560 cans/.test(on12.cans), JSON.stringify(on12));
    check('12-count tray: $6.00 a case, $5,280 for the line', on12.pcase === 6 && on12.total === 5280, JSON.stringify(on12));
    check('12-count tray charge is ticked automatically for 880 cases', on12.tray12 === 880 && on12.tray24 === null, JSON.stringify(on12));
    check('nitrogen follows to 10,560 cans', on12.nitrogen === 10560, JSON.stringify(on12));
    check('pallets: 880 ÷ 208 = 5', on12.pallet === 5, JSON.stringify(on12));
    check('2,640 cases of 12: 31,680 cans and 13 pallets at 208 a pallet', /31,680 cans/.test(big.cans) && big.pallet === 13 && big.tray12 === 2640, JSON.stringify(big));
    check('back to 24-count: same 31,680 cans as 1,320 cases, typed $7.20 becomes $14.40', back24.cases === 1320 && /31,680 cans/.test(back24.cans) && back24.pcase === 14.4, JSON.stringify(back24));
    check('back to 24-count: the 24-count tray charge replaces the 12-count one', back24.tray24 === 1320 && back24.tray12 === null, JSON.stringify(back24));
    check('a new canning line starts on the 12-count tray the last line uses', second === '12', second);
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
