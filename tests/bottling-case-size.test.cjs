/*
 * bottling-case-size.test.cjs — 6 or 12 bottles to a case, and pallets.
 *
 * A bottling line on an invoice only took a bottle count: no case size, no
 * cases, and the pallet add-on counted canning cases only, so a bottling
 * invoice billed 0 pallets. The quote builder used a flat 50 "cases" per
 * pallet for both case sizes.
 *
 * A pallet takes at most 792 bottles: 66 cases of 12 or 132 cases of 6. Each
 * bottling line now picks 12 or 6 bottles per case under its format, shows the
 * cases, and the pallet add-on counts bottling pallets.
 *
 *   node tests/bottling-case-size.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.BTL_CASE_SIZE_PORT || 8793);
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

    const id = await page.evaluate(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', is_admin: true, name: 'Test Admin' };
      window._glR = { ok: true, c: [], b: [
        { format: '750ml', format_label: '750ml Bottle', min_units: 1320, price_per_unit: 2.16 },
        { format: '750ml', format_label: '750ml Bottle', min_units: 3960, price_per_unit: 1.91 },
      ] };
      window.glLoadRates = async () => {};
      window.glGetClientOverride = () => null;
      window.openNewInvoiceBuilder();
      await wait(400);
      window.glAddLine('bottling');
      await wait(100);
      return document.querySelector('#gl-inv-body [id$="-bpc"]').closest('[data-gl-total]').id;
    });

    const snap = () => page.evaluate((id) => {
      const a = document.querySelector('#gl-inv-body [data-gl-addon="pallet"] [id$="-qty"]');
      return {
        bpc: document.getElementById(id + '-bpc').value,
        cases: document.getElementById(id + '-btlcases').textContent,
        punit: Number(document.getElementById(id + '-punit').value),
        pallet: a ? Number(a.value) : null,
        hint: document.getElementById('gl-inv-addons-hint').textContent,
      };
    }, id);
    const typeBottles = async (n) => {
      await page.fill(`#${id}-qty`, String(n));
      await page.press(`#${id}-qty`, 'Tab');
      await page.waitForTimeout(100);
    };

    await page.click('#gl-inv-addons input[data-addon="pallet"]');
    await typeBottles(792);
    const full12 = await snap();
    await typeBottles(793);
    const over12 = await snap();
    await typeBottles(1000);
    const thousand12 = await snap();
    await page.selectOption(`#${id}-bpc`, '6');
    await page.waitForTimeout(150);
    const thousand6 = await snap();
    await typeBottles(1584);
    const two6 = await snap();
    await typeBottles(1585);
    const three6 = await snap();

    // Save and reopen keeps the case size.
    const saved = await page.evaluate(() => {
      const row = document.querySelector('#gl-inv-body [id$="-bpc"]').closest('[data-gl-total]');
      return window.glBtlRowBpc(row);
    });

    check('new bottling line defaults to 12 bottles per case', full12.bpc === '12', JSON.stringify(full12));
    check('792 bottles = 66 cases of 12 = 1 pallet', /66 cases of 12/.test(full12.cases) && full12.pallet === 1, JSON.stringify(full12));
    check('793 bottles = 67 cases of 12 (last case 1) = 2 pallets', /67 cases of 12 \(last case 1\)/.test(over12.cases) && over12.pallet === 2, JSON.stringify(over12));
    check('1,000 bottles at 12 = 84 cases, 2 pallets, $2.16 a bottle', /84 cases of 12/.test(thousand12.cases) && thousand12.pallet === 2 && thousand12.punit === 2.16, JSON.stringify(thousand12));
    check('switch to 6 a case: 1,000 bottles = 167 cases of 6, 2 pallets', /167 cases of 6/.test(thousand6.cases) && thousand6.pallet === 2, JSON.stringify(thousand6));
    check('switching case size does not change the price', thousand6.punit === 2.16, JSON.stringify(thousand6));
    check('1,584 bottles at 6 = 264 cases = exactly 2 pallets', /264 cases of 6/.test(two6.cases) && two6.pallet === 2, JSON.stringify(two6));
    check('1,585 bottles at 6 = 3 pallets', three6.pallet === 3, JSON.stringify(three6));
    check('the add-on hint shows the bottling pallets', /Bottling: 1,585 bottles · 265 cases · 3 pallets/.test(three6.hint), three6.hint);
    check('the line carries its case size for saving', saved === 6, String(saved));

    // A canning line and a bottling line on one invoice: pallets add up.
    const mixed = await page.evaluate(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      window._glR.c = [{ format: '12oz-standard', format_label: '12oz Standard', min_cases: 0, price_per_can: 0.5 }];
      window.glAddLine('canning');
      await wait(100);
      const cid = document.querySelector('#gl-inv-body [id$="-cases"]').closest('[data-gl-total]').id;
      document.getElementById('gl-inv-addons-cpp').value = '80';
      const ce = document.getElementById(cid + '-cases');
      ce.value = '160';
      window.glUpdateCan(cid);
      await wait(100);
      return Number(document.querySelector('#gl-inv-body [data-gl-addon="pallet"] [id$="-qty"]').value);
    });
    check('160 canning cases (2 pallets) + 1,585 bottles at 6 (3 pallets) = 5 pallets', mixed === 5, String(mixed));

    // Quote builder: same pallet math at each case size.
    const quote = await page.evaluate(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      window.glOpenQuoteBuilder(null, null, { productType: 'bottling' });
      await wait(600);
      const bpp = document.getElementById('gl-qb-bcpp');
      const out = { label: bpp && bpp.closest('label').textContent.trim(), value: bpp && Number(bpp.value) };
      const set = (field, v) => {
        const e = document.querySelector('[data-tier-field="' + field + '"][data-tier-idx="0"]');
        e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const pallets = () => {
        // The bottling tier row's pallet cell: the count, then its cost.
        const td = document.querySelector('[data-tier-field="cases"][data-tier-idx="0"]').closest('tr').children[6];
        return Number(td.firstChild.textContent);
      };
      set('perCase', 12); await wait(150); set('cases', 132); await wait(150);
      out.p12 = pallets();
      set('perCase', 6); await wait(150); set('cases', 132); await wait(150);
      out.p6 = pallets();
      return out;
    });
    check('quote builder asks for bottles per pallet, default 792', quote.label === 'Bottles per pallet' && quote.value === 792, JSON.stringify(quote));
    check('quote: 132 cases of 12 = 2 pallets, 132 cases of 6 = 1 pallet', quote.p12 === 2 && quote.p6 === 1, JSON.stringify(quote));

    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
