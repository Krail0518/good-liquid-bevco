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
 * The other marketing sections had no phone layout either: side-by-side
 * grids, rows that never wrap and desktop gutters pushed the hero stats, the
 * about text, the services list, the process cards, the quote form and the
 * footer past the right edge. The overflow scan below checks every section
 * at 360, 390 and 768 wide, and at 1280 so the desktop never regresses.
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

// Every visible element in every section and the footer must end inside the
// viewport. Exempt: anything inside a box that scrolls sideways on purpose
// (the rate card and capabilities tables), the ticker marquee, and fixed
// elements such as #cursor. Geometry only: .rv elements start transparent.
const overflowScan = () => {
  const out = [];
  const scrollsX = (el, stop) => {
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  for (const sec of document.querySelectorAll('section, footer')) {
    if (!sec.getBoundingClientRect().width) continue;
    for (const e of sec.querySelectorAll('*')) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      if (e.closest('.ticker-inner') || scrollsX(e, sec.parentElement)) continue;
      const b = e.getBoundingClientRect();
      if (!b.width || b.right <= innerWidth + 1) continue;
      const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '';
      out.push((sec.id ? '#' + sec.id : sec.tagName.toLowerCase()) + ' ' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + cls + ' right=' + Math.round(b.right));
    }
  }
  // The first offender in each section, so every broken section is named.
  const seen = new Set();
  const perSection = out.filter((x) => { const s = x.split(' ')[0]; return !seen.has(s) && seen.add(s); });
  return { width: innerWidth, count: out.length, perSection };
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
    const adm = await pg.evaluate(() => {
      const btn = document.getElementById('admin-btn');
      const link = document.querySelector('#nav-links-list [data-gl-action="openAdmin"]');
      return { buttonShown: !!btn && getComputedStyle(btn).display !== 'none', linkShown: !!link && link.getBoundingClientRect().width > 0 };
    });
    check('phone: floating ADMIN button hidden, Admin link in the menu instead', !adm.buttonShown && adm.linkShown, JSON.stringify(adm));
    check('phone: open menu does not scroll sideways', open.scrolledX === 0, JSON.stringify(open));
    await pg.click('#mobile-menu-btn');
    await pg.evaluate(() => window.scrollTo(0, window.scrollY));

    // Nothing in any section is cut off at the right edge.
    const scan = await pg.evaluate(overflowScan);
    check('phone: no section content past the right edge', scan.count === 0, JSON.stringify(scan));
    // The hero grew taller than its fixed 100vh on a phone, and clipped the
    // headline off the top.
    const hero = await pg.evaluate(() => {
      const s = document.getElementById('hero').getBoundingClientRect();
      const h = document.querySelector('#hero .hero-c').getBoundingClientRect();
      return { heroTop: Math.round(s.top), contentTop: Math.round(h.top) };
    });
    check('phone: hero headline not clipped at the top', hero.contentTop >= hero.heroTop, JSON.stringify(hero));

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
    const dk = await desk.evaluate(() => ({
      admin: getComputedStyle(document.getElementById('admin-btn')).display !== 'none',
      // The stat numbers are gradient-clipped text: anything wider than the
      // box is invisible, which turned "200+" into "200".
      squeezed: [...document.querySelectorAll('.sc-n')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()),
    }));
    check('desktop: floating ADMIN button still shown', dk.admin, JSON.stringify(dk));
    check('desktop: About stat numbers fit their box ("200+" not "200")', dk.squeezed.length === 0, JSON.stringify(dk));
    check('desktop: no sideways scroll', d.scrolledX === 0, JSON.stringify(d));
    const dscan = await desk.evaluate(overflowScan);
    check('desktop: no section content past the right edge', dscan.count === 0, JSON.stringify(dscan));
    await desk.close();

    // A smaller phone, and the widest width the phone rules apply to.
    for (const w of [360, 768]) {
      const pw = await browser.newPage({ viewport: { width: w, height: 800 } });
      await pw.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await pw.waitForTimeout(1500);
      const ws = await pw.evaluate(overflowScan);
      check(w + 'px: no section content past the right edge', ws.count === 0, JSON.stringify(ws));
      await pw.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
