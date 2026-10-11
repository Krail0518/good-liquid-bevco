/*
 * nav-mobile-overflow.test.cjs — the marketing nav on a phone.
 *
 * Four desktop-only rules in index.css lost their @media (min-width: 769px)
 * wrapper when the styles moved out of index.html. One of them,
 * .nav-links { display: flex !important }, beat the phone rule that hides the
 * links behind the menu button: at 390px the links sat beside the button.
 *
 * The rate card had no phone layout at all: its 250px menu column pushed the
 * price panels past the right edge, where the page clips them, so most of
 * the add-on prices and the 16oz column could not be seen.
 *
 *   NODE_PATH=/tmp/pw/node_modules node tests/nav-mobile-overflow.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.NAV_PORT || 8794);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

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

const state = () => {
  const links = document.getElementById('nav-links-list');
  const btn = document.getElementById('mobile-menu-btn');
  const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  return {
    width: innerWidth,
    // The page clips overflow, so "can it scroll sideways" is the real test.
    scrolledX: (window.scrollTo(600, window.scrollY), window.scrollX),
    linksVisible: vis(links),
    buttonVisible: vis(btn),
  };
};

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const base = `http://127.0.0.1:${PORT}/index.html`;
  try {
    // Phone (iPhone 13: 390 wide, mobile UA, touch).
    const phone = await browser.newContext({ ...devices['iPhone 13'] });
    const pg = await phone.newPage();
    await pg.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pg.waitForTimeout(2500);
    const p = await pg.evaluate(state);
    check('phone: no sideways scroll', p.scrolledX === 0, JSON.stringify(p));
    check('phone: nav links hidden behind the menu button', !p.linksVisible && p.buttonVisible, JSON.stringify(p));
    await pg.click('#mobile-menu-btn');
    await pg.waitForTimeout(300);
    const open = await pg.evaluate(state);
    check('phone: menu button opens the links', open.linksVisible, JSON.stringify(open));
    check('phone: open menu does not scroll sideways', open.scrolledX === 0, JSON.stringify(open));
    await pg.click('#mobile-menu-btn');
    await pg.evaluate(() => window.scrollTo(0, window.scrollY));

    // Every rate-card panel fits on screen, prices included.
    for (const panel of ['canning', 'bottling', 'rd', 'addons']) {
      const fit = await pg.evaluate((panel) => {
        const tab = document.querySelector('[data-gl-action="showPanel"][data-gl-arg1="' + panel + '"]');
        if (tab) tab.click();
        const el = document.getElementById('panel-' + panel);
        const r = el.getBoundingClientRect();
        // Tables may scroll inside their own box; everything else must fit.
        const cut = [...el.querySelectorAll('*')].filter((e) => {
          if (e.closest('table') || e.children.length) return false;
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.right > innerWidth + 1;
        }).map((e) => e.textContent.trim().slice(0, 30));
        return { left: Math.round(r.left), right: Math.round(r.right), width: innerWidth, cut: cut.slice(0, 5) };
      }, panel);
      check('phone: ' + panel + ' prices fit on screen', fit.left >= 0 && fit.right <= fit.width && fit.cut.length === 0, JSON.stringify(fit));
    }
    await phone.close();

    // Desktop: links shown inline, no menu button.
    const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await desk.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await desk.waitForTimeout(2500);
    const d = await desk.evaluate(state);
    check('desktop: nav links shown, menu button hidden', d.linksVisible && !d.buttonVisible, JSON.stringify(d));
    check('desktop: no sideways scroll', d.scrolledX === 0, JSON.stringify(d));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
