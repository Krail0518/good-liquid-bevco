/*
 * launch-packages.test.cjs: Formula to Shelf packages as checkboxes in the
 * quote builder and the invoice builder.
 *
 * Loads the real page, opens the real builders and drives them the way a
 * person does: tick a package, change the SKU count, untick it.
 *
 *   Quote builder
 *     - ticking Core Launch adds a whole-job line, saved with the quote
 *     - Core offers the launch rate: canning fill two volume tiers lower
 *       (501 cases: $0.38 becomes $0.31), on by default, off when unticked
 *     - a typed fill rate is left alone
 *   Invoice builder
 *     - ticking a package adds one line, qty and price follow the panel
 *     - editing the line's price writes back to the panel
 *     - unticking removes the line
 *     - an invoice made from a quote ticks the matching box, no duplicate
 *
 *   NODE_PATH=/tmp/pw/node_modules node tests/launch-packages.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.LAUNCH_PKG_PORT || 8794);
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
  else { console.log(`  FAIL: ${name}${detail ? ' (' + detail + ')' : ''}`); failures.push(name); }
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

    const r = await page.evaluate(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
      window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', is_admin: true, name: 'Test Admin' };
      const out = {};

      /* ── Quote builder ── */
      window.glOpenQuoteBuilder(null, null, { productType: 'canning' });
      await wait(500);
      const ov = document.getElementById('gl-qb-modal');
      out.qPanel = !!ov.querySelector('#gl-qb-launch input[data-launch="launch_core"]');
      document.getElementById('gl-qb-fmt').value = '12oz Standard';
      fire(document.getElementById('gl-qb-fmt'), 'change');
      await wait(100);
      ov.querySelector('#gl-qb-auto-tiers').click();      // 501 / 1000 / 5000 cases
      await wait(100);
      const fills = () => [...ov.querySelectorAll('[data-tier-field="fillPerCan"]')].map((i) => Number(i.value));
      out.fillBefore = fills();

      const qty = ov.querySelector('#gl-qb-launch input[data-launch-qty="launch_core"]');
      qty.value = '2'; fire(qty, 'input');
      const core = ov.querySelector('#gl-qb-launch input[data-launch="launch_core"]');
      core.checked = true; fire(core, 'change');
      await wait(100);
      out.fillDiscount = fills();
      out.discountShown = !!ov.querySelector('#gl-qb-launch-discount');
      out.discountOn = ov.querySelector('#gl-qb-launch-discount').checked;
      const data = ov.glQuoteData();
      out.qLine = (data.quoteLines || []).find((l) => l.launch === 'launch_core') || null;

      const disc = ov.querySelector('#gl-qb-launch-discount');
      disc.checked = false; fire(disc, 'change');
      await wait(100);
      out.fillDiscountOff = fills();
      const disc2 = ov.querySelector('#gl-qb-launch-discount');
      disc2.checked = true; fire(disc2, 'change');
      await wait(100);

      // A typed fill rate is kept.
      const f0 = ov.querySelector('[data-tier-field="fillPerCan"]');
      f0.value = '0.45'; fire(f0, 'input');
      const core2 = ov.querySelector('#gl-qb-launch input[data-launch="launch_core"]');
      core2.checked = false; fire(core2, 'change');
      await wait(100);
      out.fillAfterUntick = fills();
      out.qLinesAfterUntick = (ov.glQuoteData().quoteLines || []).filter((l) => l.launch).length;
      document.getElementById('gl-qb-close').click();

      /* ── Invoice builder ── */
      window._glR = { ok: true, b: [], c: [{ format: '12oz-standard', format_label: '12oz Standard', min_cases: 0, price_per_can: 0.5 }] };
      window.glLoadRates = async () => {};
      window.glGetClientOverride = () => null;
      window.openNewInvoiceBuilder();
      await wait(500);
      const P = () => document.getElementById('gl-inv-launch');
      out.iPanel = !!P();
      const rowOf = (key) => document.querySelector('#gl-inv-body [data-gl-launch="' + key + '"]');
      const iq = P().querySelector('input[data-launch-qty="launch_full"]');
      iq.value = '3'; fire(iq, 'input');
      const full = P().querySelector('input[data-launch="launch_full"]');
      full.checked = true; fire(full, 'change');
      await wait(100);
      const row = rowOf('launch_full');
      out.iRow = row ? { qty: Number(row.querySelector('[id$="-qty"]').value), price: Number(row.querySelector('[id$="-price"]').value), text: row.textContent } : null;
      const rp = row.querySelector('[id$="-price"]');
      rp.value = '7000'; fire(rp, 'input');
      out.panelRate = Number(P().querySelector('input[data-launch-rate="launch_full"]').value);
      full.checked = false; fire(full, 'change');
      await wait(100);
      out.iRowGone = !rowOf('launch_full');
      document.querySelectorAll('[data-gl-action="closeInvBuilder"], #gl-inv-close').forEach((b) => b.click());

      /* ── Invoice from a quote ── */
      await window.glInvoiceFromQuote({ clientId: null, quoteNumber: 'Q-TEST', items: [
        { desc: 'Formula to Shelf: Core Launch', qty: 2, unit: 'SKU', unitPrice: 4250, total: 8500 }
      ] });
      await wait(500);
      out.fqTicked = !!(P() && P().querySelector('input[data-launch="launch_core"]').checked);
      out.fqRows = document.querySelectorAll('#gl-inv-body [data-gl-launch="launch_core"]').length;
      out.fqQty = Number((P().querySelector('input[data-launch-qty="launch_core"]') || {}).value);
      return out;
    });

    check('quote builder shows the package boxes', r.qPanel);
    check('deck fill before any package is 0.38 / 0.35 / 0.28', JSON.stringify(r.fillBefore) === JSON.stringify([0.38, 0.35, 0.28]), JSON.stringify(r.fillBefore));
    check('Core Launch offers the launch rate, on by default', r.discountShown && r.discountOn);
    check('launch rate prices fill two tiers lower (0.31 / 0.28 / 0.28)', JSON.stringify(r.fillDiscount) === JSON.stringify([0.31, 0.28, 0.28]), JSON.stringify(r.fillDiscount));
    check('Core Launch saved as a whole-job line, 2 SKUs at $4,250', r.qLine && r.qLine.qty === 2 && r.qLine.rate === 4250 && r.qLine.desc === 'Formula to Shelf: Core Launch', JSON.stringify(r.qLine));
    check('unticking the launch rate restores deck fill', JSON.stringify(r.fillDiscountOff) === JSON.stringify([0.38, 0.35, 0.28]), JSON.stringify(r.fillDiscountOff));
    check('a typed fill rate is kept; unticking Core restores the rest', JSON.stringify(r.fillAfterUntick) === JSON.stringify([0.45, 0.35, 0.28]), JSON.stringify(r.fillAfterUntick));
    check('unticking Core removes its line from the quote', r.qLinesAfterUntick === 0);
    check('invoice builder shows the package boxes', r.iPanel);
    check('ticking Full Launch adds one line, 3 SKUs at $7,500', r.iRow && r.iRow.qty === 3 && r.iRow.price === 7500 && /Full Launch/.test(r.iRow.text), JSON.stringify(r.iRow));
    check('editing the line price writes back to the panel', r.panelRate === 7000, String(r.panelRate));
    check('unticking removes the line', r.iRowGone);
    check('invoice from a quote ticks Core, one row, qty 2', r.fqTicked && r.fqRows === 1 && r.fqQty === 2, JSON.stringify({ t: r.fqTicked, n: r.fqRows, q: r.fqQty }));
    const ours = errors.filter((e) => /launch|quote|invoice/i.test(e));
    check('no page errors from the builders', ours.length === 0, ours.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error('harness crash:', e); process.exit(1); });
