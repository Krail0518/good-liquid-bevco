/*
 * cip-history-search.test.cjs — "When was FB6 last cleaned?"
 *
 * WHAT THIS PROVES
 * ----------------
 * The CIP page (src/modules/production/cip-audit.js) driven in a browser
 * against an in-memory stand-in for Supabase:
 *
 *   - searching a tank asks the DATABASE for every matching cycle, not just
 *     the newest 200 already on screen (a rarely cleaned tank falls off that
 *     list, which is the whole complaint)
 *   - spaces, dashes and other punctuation are ignored: "FV6", "fv 6" and
 *     "FV-6" all find a tank saved as "FV 6" (or "FV-6"), but not "FV16"
 *   - the summary answers the question: last cleaned date, and the last
 *     PASSING clean when the newest cycle failed
 *   - the history is newest first, with the year shown
 *   - a row from the history opens its step detail even when it is older
 *     than anything on the main list
 *   - equipment names carrying script do not execute (CLAUDE.md rule 5)
 *   - "Show all cycles" goes back to the normal list
 *
 * Run:  NODE_PATH=… node tests/cip-history-search.test.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8948;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const XSS = '<img src=x onerror="window.__xss=1">';
function cyc(id, equip, start, status, dev) {
  return { id, form_code: 'GMP-SAN-002', status, has_deviation: !!dev, recorded_at: start, deviation_notes: dev || null,
    data: { equipment: equip, cycle_start: start, operator: 'Op ' + id, steps: [{ n: 1, done: true }] } };
}
// The newest cycles (what the main list shows) are all on other equipment.
// FB6 has only old cycles, the newest of which FAILED.
const RECENT = [cyc('r1', 'Filling Line 1', '2026-10-02T09:00:00Z', 'signed'), cyc('r2', 'Evil ' + XSS, '2026-10-01T09:00:00Z', 'signed')];
const FB6 = [
  cyc('f1', 'FB6', '2026-03-14T08:00:00Z', 'signed'),
  cyc('f2', 'FB6', '2026-05-20T08:00:00Z', 'complete', 'Step 4 temp 150°F < 160°F'),
  cyc('f3', 'FB6', '2025-11-02T08:00:00Z', 'signed'),
];
const FBX6 = [cyc('x1', 'FBX6', '2026-06-01T08:00:00Z', 'signed')];
// The same fermenter saved three ways, plus a different tank whose name
// shares the letters.
const FV6 = [cyc('v1', 'FV 6', '2026-09-01T08:00:00Z', 'signed'), cyc('v2', 'FV-6', '2026-08-01T08:00:00Z', 'signed'),
  cyc('v3', 'fv6', '2026-07-01T08:00:00Z', 'signed'), cyc('v4', 'FV16', '2026-09-02T08:00:00Z', 'signed')];
const ALL = RECENT.concat(FB6, FBX6, FV6);

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<div id="cpg-cip" class="cpg"><div id="cip-sub"></div><div id="cip-body"></div></div>
<script>
window.glEsc = function(s){ return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){
  return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]; }); };
var ALL = ${JSON.stringify(ALL)};
window.__queries = [];
function Q(){ this.f = []; this.rx = null; this.lim = null; }
Q.prototype.select = function(){ return this; };
Q.prototype.order = function(){ return this; };
Q.prototype.eq = function(k, v){ this.f.push([k, v]); return this; };
Q.prototype.regexIMatch = function(k, v){ this.rx = [k, v]; return this; };
Q.prototype.limit = function(n){ this.lim = n; return this; };
Q.prototype.then = function(res, rej){
  var self = this;
  window.__queries.push({ rx: self.rx, limit: self.lim });
  var rows = ALL.filter(function(r){ return self.f.every(function(f){ return r[f[0]] === f[1]; }); });
  if(self.rx){
    // Postgres ~* semantics: unanchored, case-insensitive. The one POSIX
    // class the page uses is translated to its JS equivalent.
    var rx = new RegExp(self.rx[1].split('[^[:alnum:]]').join('[^\\\\p{L}\\\\p{N}]'), 'iu');
    rows = rows.filter(function(r){ return rx.test(r.data.equipment); });
  } else {
    // The main list: newest 2 only, standing in for the 200-row cap.
    rows = rows.slice().sort(function(a, b){ return a.recorded_at < b.recorded_at ? 1 : -1; }).slice(0, 2);
  }
  return Promise.resolve({ data: rows, error: null }).then(res, rej);
};
window.supa = { from: function(){ return new Q(); } };
<\/script>
<script src="/src/modules/production/cip-audit.js"><\/script></body>`;

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (p === '/src/modules/production/cip-audit.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(fs.readFileSync(path.join(ROOT, 'src/modules/production/cip-audit.js')));
  }
  res.writeHead(404); res.end();
});

(async () => {
  console.log('CIP tank history search\n');
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });

  // Open the page the way cNav does: add the 'act' class.
  await page.evaluate(() => document.getElementById('cpg-cip').classList.add('act'));
  await page.waitForSelector('#gl-cip-search', { timeout: 5000 });
  const main = await page.evaluate(() => ({
    text: document.getElementById('cip-body').innerText,
    xss: window.__xss === 1 || !!document.querySelector('#cip-body img'),
    opts: [...document.querySelectorAll('#gl-cip-equip-list option')].map((o) => o.value),
  }));
  check('main list does not show FB6 (it is older than the newest cycles)', !/FB6/.test(main.text), main.text);
  check('script in an equipment name does not run', !main.xss);
  check('the search box suggests equipment already seen', main.opts.indexOf('Filling Line 1') >= 0, JSON.stringify(main.opts));

  // Search FB6
  await page.fill('#gl-cip-search', 'fb6');
  await page.press('#gl-cip-search', 'Enter');
  await page.waitForFunction(() => /cycles? for/.test(document.getElementById('cip-body').innerText), null, { timeout: 5000 });
  const res = await page.evaluate(() => ({
    text: document.getElementById('cip-body').innerText,
    rows: [...document.querySelectorAll('#cip-body tbody tr')].map((r) => r.getAttribute('data-gl-arg1')),
    q: window.__queries[window.__queries.length - 1],
  }));
  check('the search went to the database with a separator-tolerant match on equipment',
    res.q.rx && res.q.rx[0] === 'data->>equipment' && res.q.rx[1] === 'f[^[:alnum:]]*b[^[:alnum:]]*6' && res.q.limit >= 1000, JSON.stringify(res.q));
  check('every FB6 cycle is listed, case-insensitively, newest first',
    JSON.stringify(res.rows.filter((id) => /^f/.test(id))) === '["f2","f1","f3"]', JSON.stringify(res.rows));
  check('FBX6 is a different tank and is not listed', res.rows.indexOf('x1') < 0, JSON.stringify(res.rows));
  check('summary: 3 cycles on record', /3 cycles on record/.test(res.text), res.text.slice(0, 400));
  check('summary: last cleaned May 20, 2026, and it FAILED', /Last cleaned: May 20, 2026/.test(res.text) && /FAIL/.test(res.text), res.text.slice(0, 400));
  check('summary: last passing clean Mar 14, 2026', /Last passing clean: Mar 14, 2026/.test(res.text), res.text.slice(0, 500));
  check('history rows show the year', /Nov 2, 2025/.test(res.text));

  // Spaces, dashes and other punctuation are ignored
  async function searchFor(term) {
    await page.fill('#gl-cip-search', term);
    await page.press('#gl-cip-search', 'Enter');
    await page.waitForFunction((t) => document.getElementById('cip-body').innerText.indexOf(t) >= 0 && !/Searching/.test(document.getElementById('cip-body').innerText), term, { timeout: 5000 });
    return page.evaluate(() => ({
      text: document.getElementById('cip-body').innerText,
      rows: [...document.querySelectorAll('#cip-body tbody tr')].map((r) => r.getAttribute('data-gl-arg1')).sort(),
      q: window.__queries[window.__queries.length - 1],
    }));
  }
  for (const term of ['FV6', 'fv 6', 'FV-6', 'F.V 6']) {
    const r = await searchFor(term);
    check('"' + term + '" finds FV 6, FV-6 and fv6 but not FV16', JSON.stringify(r.rows) === '["v1","v2","v3"]', JSON.stringify(r.rows));
  }
  const us = await searchFor('FB_6');
  check('an underscore is a separator, not a wildcard: "FB_6" finds FB6 and not FBX6',
    JSON.stringify(us.rows) === '["f1","f2","f3"]' && us.q.rx[1] === 'F[^[:alnum:]]*B[^[:alnum:]]*6', JSON.stringify(us));
  const pct = await searchFor('%');
  check('a search with no letters or digits does not query, and finds nothing', /No CIP cycles on record/.test(pct.text) && pct.q.rx[1] === us.q.rx[1], pct.text.slice(0, 200));

  // Detail of an old cycle opens
  await page.fill('#gl-cip-search', 'FB6');
  await page.press('#gl-cip-search', 'Enter');
  await page.waitForSelector('#cip-body tr[data-gl-arg1="f3"]', { timeout: 5000 });
  const detail = await page.evaluate(() => { window.glOpenCipDetail('f3'); const d = document.getElementById('gl-cip-detail'); return d ? d.innerText : ''; });
  check('an old cycle from the history opens its detail', /CIP CYCLE DETAIL/.test(detail) && /FB6/.test(detail), detail.slice(0, 200));
  await page.evaluate(() => { const d = document.getElementById('gl-cip-detail'); if (d) d.remove(); });

  // Back to everything
  await page.click('#gl-cip-search-clear');
  const back = await page.evaluate(() => ({ text: document.getElementById('cip-body').innerText, val: document.getElementById('gl-cip-search').value }));
  check('"Show all cycles" returns to the normal list', !/FB6/.test(back.text) && /Filling Line 1/.test(back.text) && back.val === '', back.text.slice(0, 200));

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
