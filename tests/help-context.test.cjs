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
 * This drives the real help.js + help-features.js in Chromium: every page in
 * index.html is made active, the topbar ❓ Help button is clicked, and the
 * section expected for that page must be the one at the top of the panel.
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

const PAGE = '<!doctype html><meta charset="utf-8"><body>' +
  '<script>window.GL_HOOKS = { _navHooks: [], registerNavHook: function(){}, registerLoginHook: function(){} };</script>' +
  '<div id="crm-panel" class="show"><div id="crm-top"><div><div class="crm-brand">GL</div></div></div>' +
  PAGES.map((id) => '<div id="' + id + '" class="cpg"></div>').join('') + '</div>' +
  '<script src="/src/shared/help.js"></script><script src="/src/shared/help-features.js"></script></body>';

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
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
      const bt = body.getBoundingClientRect().top;
      // The section whose top is nearest the top of the panel.
      let best = null, bestD = 1e9;
      body.querySelectorAll('section[id^="help-"]').forEach((s) => {
        const d = Math.abs(s.getBoundingClientRect().top - bt);
        if (d < bestD) { bestD = d; best = s.id; }
      });
      const toc = document.querySelector('#gl-help-toc a[style*="var(--teal)"]');
      return { top: best, dist: Math.round(bestD), toc: toc && toc.getAttribute('data-anchor') };
    });
    if (got.top !== want || got.dist > 40) wrong.push(id + ' -> ' + got.top + ' (' + got.dist + 'px), want ' + want);
    if (id === 'cpg-warehouse') {
      check('Warehouse Storage: help opens on its own section and highlights it in the contents',
        got.top === 'help-warehouse' && got.toc === 'help-warehouse', JSON.stringify(got));
    }
    if (id === 'cpg-pipeline') check('Pipeline opens Pipeline help, not Correspondence', got.top === 'help-pipeline', JSON.stringify(got));
    if (id === 'cpg-audit') check('Audit Log waits for the add-on section and lands on it', got.top === 'help-qs', JSON.stringify(got));
  }
  check('all ' + PAGES.length + ' pages open their own help section', wrong.length === 0, wrong.join('\n          '));

  // A person scrolling while it loads is never fought.
  await page.evaluate(() => {
    const m = document.getElementById('gl-help-modal'); if (m) m.remove();
    document.querySelectorAll('.cpg').forEach((el) => el.classList.toggle('act', el.id === 'cpg-audit'));
  });
  await page.click('.gl-help-btn');
  await page.waitForSelector('#gl-help-body');
  await page.evaluate(() => { const b = document.getElementById('gl-help-body'); b.dispatchEvent(new WheelEvent('wheel')); b.scrollTop = 0; });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => document.getElementById('gl-help-body').scrollTop);
  check('scrolling yourself stops the automatic jump', st === 0, 'scrollTop=' + st);

  const wh = await page.evaluate(() => (document.getElementById('help-warehouse') || {}).innerText || '');
  check('the Warehouse section explains the 4 steps, notes and printing',
    /4 steps of every move/.test(wh) && /Pallet notes/.test(wh) && /Print paperwork/.test(wh) && /Good Liquid \(own packaging\)/.test(wh), wh.slice(0, 200));
  const inv = await page.evaluate(() => (document.getElementById('help-inventory') || {}).innerText || '');
  check('Inventory help no longer says the data stays on one device', !/localStorage/.test(inv) && /saved to the cloud/.test(inv));

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
