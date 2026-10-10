/*
 * help-context.test.cjs — the Help button opens the help for the page you are on.
 *
 * It did not. Seven pages (Warehouse Storage, Daily GMP, GMP Schedule,
 * Trace / Recall, Training, Internal Audit, Audit Log) had no entry in the
 * page-to-section map and opened at the top of the guide; help-features.js
 * then overrode ten more (Pipeline and Clients went to Correspondence, and so
 * on); and the scroll ran once, 60 ms after opening, before the add-on
 * sections it pointed at existed.
 *
 * Even when it scrolled to the right place it still opened the WHOLE guide,
 * which read as "generic help". It now shows only that page's section, titled
 * with the page's name, with "📚 Full guide" to see everything.
 *
 * This drives the real help.js + help-features.js in Chromium: every page in
 * index.html is made active, the topbar ❓ Help button is clicked, and the
 * only section showing must be the one expected for that page.
 *
 * Run:  NODE_PATH=… node tests/help-context.test.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8949;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PAGES = [...new Set((html.match(/id="cpg-[a-z0-9-]+"/g) || []).map((m) => m.slice(4, -1)))];

// What each page should open. A page added to index.html without a line here
// fails the test, which is the point: decide where its help is.
const EXPECT = {
  'cpg-dashboard': 'help-dashboard', 'cpg-clients': 'help-clients', 'cpg-pipeline': 'help-pipeline',
  'cpg-invoices': 'help-invoices', 'cpg-newinv': 'help-newinv', 'cpg-referrals': 'help-referrals',
  'cpg-referrers': 'help-referrers', 'cpg-activity': 'help-activity', 'cpg-calendar': 'help-calendar',
  'cpg-production-cal': 'help-production', 'cpg-tasks': 'help-tasks', 'cpg-documents': 'help-documents',
  'cpg-inventory': 'help-inventory', 'cpg-announcements': 'help-announcements', 'cpg-customers': 'help-customers',
  'cpg-users': 'help-users', 'cpg-compliance': 'help-compliance', 'cpg-holds': 'help-hold-tags',
  'cpg-cip': 'help-cip-log', 'cpg-production-runs': 'help-production-runs', 'cpg-formulas': 'help-formula-vault',
  'cpg-yield': 'help-yield-tracker', 'cpg-samples': 'help-sample-shipments', 'cpg-content': 'help-content-calendar',
  'cpg-defects': 'help-defects-ncr', 'cpg-vendors': 'help-vendors', 'cpg-warehouse': 'help-warehouse',
  'cpg-gmp': 'help-daily-gmp', 'cpg-gmpsched': 'help-gmp-schedule', 'cpg-trace': 'help-trace-recall',
  'cpg-training': 'help-training-gmp', 'cpg-auditreview': 'help-internal-audit', 'cpg-audit': 'help-qs',
};

// The real stylesheet (the one-page view's rules live there) and the real
// Content-Security-Policy from vercel.json, so a <style> the CSP would block in
// production is blocked here too.
const CSP = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers[0].headers
  .find((h) => h.key === 'Content-Security-Policy').value.replace(/;\s*upgrade-insecure-requests/, '');
const PAGE = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/crm-runtime.css"><body>' +
  '<script src="/test-hooks.js"></script>' +
  '<div id="crm-panel" class="show"><div id="crm-top"><div><div class="crm-brand">GL</div></div></div>' +
  PAGES.map((id) => '<div id="' + id + '" class="cpg"></div>').join('') + '</div>' +
  '<script src="/src/shared/help.js"></script><script src="/src/shared/help-features.js"></script></body>';

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP }); return res.end(PAGE); }
  if (p === '/test-hooks.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.GL_HOOKS = { _navHooks: [], registerNavHook: function(){}, registerLoginHook: function(){} };'); }
  if (p === '/crm-runtime.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(fs.readFileSync(path.join(ROOT, p))); }
  if (p === '/src/shared/help.js' || p === '/src/shared/help-features.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, p)));
  }
  res.writeHead(404); res.end();
});

(async () => {
  console.log('Help opens on the page you are on\n');
  const unmapped = PAGES.filter((id) => !EXPECT[id]);
  check('every page in index.html has an expected help section in this test', unmapped.length === 0, unmapped.join(', '));

  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 160)); });
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForSelector('.gl-help-btn', { timeout: 5000 });

  const wrong = [];
  for (const id of PAGES) {
    const want = EXPECT[id];
    if (!want) continue;
    await page.evaluate((pid) => {
      const m = document.getElementById('gl-help-modal'); if (m) m.remove();
      document.querySelectorAll('.cpg').forEach((el) => el.classList.toggle('act', el.id === pid));
    }, id);
    await page.click('.gl-help-btn');
    // Settled: the scroll has had its full retry window.
    await page.waitForTimeout(1200);
    const got = await page.evaluate(() => {
      const body = document.getElementById('gl-help-body');
      if (!body) return { top: null };
      const shown = [...body.querySelectorAll(':scope > section')].filter((x) => x.offsetParent !== null).map((x) => x.id);
      const toc = document.querySelector('#gl-help-toc a[style*="var(--teal)"]');
      return { top: shown.length === 1 ? shown[0] : shown.join('+') || 'none', dist: 0, n: shown.length,
        where: document.getElementById('gl-help-where').textContent, toc: toc && toc.getAttribute('data-anchor') };
    });
    if (got.top !== want || !/^Help for this page: /.test(got.where)) wrong.push(id + ' -> ' + got.top + ' [' + got.where + '], want ' + want);
    if (id === 'cpg-warehouse') {
      check('Warehouse Storage: help opens on its own section and highlights it in the contents',
        got.top === 'help-warehouse' && got.toc === 'help-warehouse', JSON.stringify(got));
    }
    if (id === 'cpg-pipeline') check('Pipeline opens Pipeline help, not Correspondence', got.top === 'help-pipeline', JSON.stringify(got));
    if (id === 'cpg-audit') check('Audit Log waits for the add-on section and lands on it', got.top === 'help-qs', JSON.stringify(got));
  }
  check('all ' + PAGES.length + ' pages show only their own help section, titled for the page', wrong.length === 0, wrong.join('\n          '));

  // On Warehouse Storage: the title, the Full guide button, and back.
  await page.evaluate(() => {
    const m = document.getElementById('gl-help-modal'); if (m) m.remove();
    document.querySelectorAll('.cpg').forEach((el) => el.classList.toggle('act', el.id === 'cpg-warehouse'));
  });
  await page.click('.gl-help-btn');
  await page.waitForFunction(() => /Help for this page/.test((document.getElementById('gl-help-where') || {}).textContent || ''), null, { timeout: 4000 });
  const wh1 = await page.evaluate(() => ({ where: document.getElementById('gl-help-where').textContent, btn: document.getElementById('gl-help-mode').textContent }));
  check('Warehouse: titled "Help for this page: 🏬 Warehouse Storage" with a Full guide button',
    wh1.where === 'Help for this page: 🏬 Warehouse Storage' && /Full guide/.test(wh1.btn), JSON.stringify(wh1));
  await page.click('#gl-help-mode');
  await page.waitForTimeout(200);
  const full = await page.evaluate(() => {
    const body = document.getElementById('gl-help-body');
    const shown = [...body.querySelectorAll(':scope > section')].filter((x) => x.offsetParent !== null).length;
    const w = document.getElementById('help-warehouse').getBoundingClientRect().top - body.getBoundingClientRect().top;
    return { shown, w: Math.round(w), btn: document.getElementById('gl-help-mode').textContent };
  });
  check('📚 Full guide shows every section and keeps Warehouse in view', full.shown > 40 && Math.abs(full.w) < 40 && /This page only/.test(full.btn), JSON.stringify(full));
  await page.click('#gl-help-mode');
  await page.waitForTimeout(200);
  await page.click('#gl-help-toc a[data-anchor="help-inventory"]');
  await page.waitForTimeout(200);
  const sw = await page.evaluate(() => ({ shown: [...document.querySelectorAll('#gl-help-body > section')].filter((x) => x.offsetParent !== null).map((x) => x.id),
    where: document.getElementById('gl-help-where').textContent }));
  check('in the one-page view, the contents list switches which page is shown', JSON.stringify(sw.shown) === '["help-inventory"]' && /Inventory/.test(sw.where), JSON.stringify(sw));
  await page.evaluate(() => { const m = document.getElementById('gl-help-modal'); if (m) m.remove(); window.glOpenHelp('help-overview'); });
  await page.waitForTimeout(300);
  const ov = await page.evaluate(() => [...document.querySelectorAll('#gl-help-body > section')].filter((x) => x.offsetParent !== null).length);
  check('opening the overview still shows the full guide', ov > 40, String(ov));

  const wh = await page.evaluate(() => (document.getElementById('help-warehouse') || {}).innerText || '');
  check('the Warehouse section explains the 4 steps, notes and printing',
    /4 steps of every move/.test(wh) && /Pallet notes/.test(wh) && /Print paperwork/.test(wh) && /Good Liquid \(own packaging\)/.test(wh), wh.slice(0, 200));
  const vids = await page.evaluate(() => ({
    wh: [...document.querySelectorAll('#help-warehouse video')].map((v) => v.getAttribute('src')),
    gallery: [...document.querySelectorAll('#help-videos video')].map((v) => v.getAttribute('src')),
    all: [...new Set([...document.querySelectorAll('#gl-help-body video')].map((v) => v.getAttribute('src')))],
  }));
  check('the Warehouse section opens with its training video, which is also in the video gallery',
    vids.wh[0] === '/tutorials/tutorial-warehouse.mp4' && vids.gallery.includes('/tutorials/tutorial-warehouse.mp4'), JSON.stringify(vids.wh));
  const missing = vids.all.filter((src) => !fs.existsSync(path.join(ROOT, src)));
  check('every video the help panel links to exists in the repo', vids.all.length > 0 && missing.length === 0, missing.join(', '));
  const inv = await page.evaluate(() => (document.getElementById('help-inventory') || {}).innerText || '');
  check('Inventory help no longer says the data stays on one device', !/localStorage/.test(inv) && /saved to the cloud/.test(inv));

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
