/*
 * estimator-case-size.test.cjs — the public price estimator and 12-can cases.
 *
 * The estimator on the marketing page fixed a case at 24 cans: the label said
 * "24 per case" and pasteurization and nitrogen were cases × 24 × the per-can
 * rate. A brand packing 12-count trays could not price its run. It now has a
 * 24 / 12 cans-per-case picker; a 12-can run is priced and tiered by its
 * 24-can equivalent (same price per can, half the price per case).
 *
 *   NODE_PATH=/tmp/pw/node_modules node tests/estimator-case-size.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.ESTIMATOR_PORT || 8793);
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
  await page.emulateMedia({ reducedMotion: 'reduce' });   // total snaps instead of counting up
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const r = await page.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      const set = (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new Event('change')); };
      const read = () => ({
        total: $('qc-total').textContent,
        cans: $('qc-cans').textContent,
        bd: $('qc-breakdown').textContent,
        cases: Number($('qc-cases').value),
      });
      if (!$('qc-cancase')) return { missing: true };
      set('qc-service', 'canning'); set('qc-format', '12std');
      const n = $('qc-nitro'); n.checked = true; n.dispatchEvent(new Event('change'));
      set('qc-cases', '1000');
      const c24 = read();
      set('qc-cancase', '12');
      const c12 = read();
      set('qc-cases', '200');
      const min12 = read();
      return { c24, c12, min12 };
    });

    check('estimator has a cans-per-case picker', !r.missing);
    if (!r.missing) {
      // 1,000 × 24-can cases: tier 1000 = $8.40/case → $8,400; nitro 24,000 × $0.03 = $720.
      check('24-can: 1,000 cases = 24,000 cans, $9,120 with nitrogen', /24,000 cans/.test(r.c24.cans) && r.c24.total === '$9,120', JSON.stringify(r.c24));
      // 1,000 × 12-can cases = 500 rate-card cases: tier 501 not reached → 340 tier $10.32 × 500 = $5,160; nitro 12,000 × .03 = $360.
      check('12-can: 1,000 cases = 12,000 cans, $5,520 with nitrogen', /12,000 cans/.test(r.c12.cans) && r.c12.total === '$5,520', JSON.stringify(r.c12));
      check('12-can: breakdown shows $5.16 per 12-can case', /cases of 12 @ \$5\.16\/case/.test(r.c12.bd), r.c12.bd);
      check('12-can: minimum run is 400 cases (same 4,800 cans as 200 × 24)', r.min12.cases === 400, JSON.stringify(r.min12));
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
