/*
 * compliance-print.test.cjs — Print / PDF for the CIP log and calibration.
 *
 * WHAT THIS PROVES
 * ----------------
 * Driven in a browser against an in-memory stand-in for Supabase:
 *
 * CIP / Sanitation Log (src/modules/production/cip-audit.js)
 *   - the toolbar Print button opens a printout of the cycles on screen,
 *     oldest first, each with its 9-step table, result and signature
 *   - a searched tank prints only that tank's cycles
 *   - a cycle held only in this browser is left off and the printout says so
 *   - the cycle detail's Print button prints that one cycle
 *   - free text on the CIP form shows as Notes, not as a red Deviation, when
 *     the cycle did not fail (the form saves it as corrective_action always)
 *
 * Calibration register (src/modules/production/gmp.js)
 *   - the Instrument filter narrows the list and the printout to the pH meter
 *   - records from BOTH calibration forms print their values (the Compliance
 *     form and the Daily GMP template store different keys)
 *   - a failed check is marked FAIL
 *
 * Both: script in any typed value never runs in the printout (CLAUDE.md rule 5).
 *
 * Run:  NODE_PATH=… node tests/compliance-print.test.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8951;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const XSS = '<img src=x onerror="window.opener.__xss=1">';
function steps(over) {
  const names = ['Pre-Rinse', 'PBW Wash', 'Intermediate Rinse #1', 'Caustic Wash (NaOH)', 'Intermediate Rinse #2', 'Acid Wash', 'Final Rinse', 'POST-CIP PAA Sanitize', 'PRE-USE PAA (at run time)'];
  return names.map((name, i) => Object.assign({ n: i + 1, name, done: true, actual_min: 30, target_min: 30, temp_f: i < 7 ? 165 : null, reading: i === 7 ? '150 ppm' : '', pf: 'pass' }, (over || {})[i + 1] || {}));
}
function cip(id, equip, start, extra) {
  return Object.assign({ id, form_code: 'GMP-SAN-002', status: 'signed', has_deviation: false, recorded_at: start, record_date: start.slice(0, 10),
    signature_name: 'Pat PCQI', signed_at: start, deviation_notes: null, corrective_action: null,
    data: { equipment: equip, cycle_start: start, operator: 'Op ' + id, steps: steps() } }, extra || {});
}
const CIP = [
  cip('c2', 'Filling Line 1', '2026-11-12T12:15:00Z', { corrective_action: 'Swapped PAA strip lot', data: { equipment: 'Filling Line 1', cycle_start: '2026-11-12T12:15:00Z', operator: 'Op c2', deviation_notes: 'Swapped PAA strip lot', steps: steps() } }),
  cip('c1', 'FB6 ' + XSS, '2026-11-10T12:00:00Z', { status: 'complete', signature_name: null, has_deviation: true,
    deviation_notes: 'Step 4 temp 150°F < 160°F', corrective_action: 'Repeated caustic',
    data: { equipment: 'FB6 ' + XSS, cycle_start: '2026-11-10T12:00:00Z', operator: 'Op c1', steps: steps({ 4: { temp_f: 150, pf: 'fail' }, 9: { done: false, actual_min: 0, pf: 'pass' } }) } }),
];
const LOCAL = [Object.assign(cip('tmp_1', 'Mix tank', '2026-11-13T12:00:00Z'), { _localOnly: true, _dbError: 'denied', status: 'draft' })];

const CAL_TPL = { form_code: 'GMP-CAL-001', title: 'Calibration Verification', in_daily: false, fields: [
  { key: 'instrument', label: 'Instrument / device', type: 'text' }, { key: 'instrument_id', label: 'Instrument ID / serial', type: 'text' },
  { key: 'reference', label: 'Reference standard used', type: 'text' }, { key: 'as_found', label: 'As-found reading', type: 'number' },
  { key: 'as_left', label: 'As-left reading', type: 'number' }, { key: 'tolerance_ok', label: 'Within tolerance', type: 'passfail' },
  { key: 'next_due', label: 'Next calibration due', type: 'date' }, { key: 'performed_by', label: 'Performed by', type: 'text' } ] };
const CAL = [
  // From the Compliance form (glOpenCalForm)
  { id: 'k1', form_code: 'GMP-CAL-001', status: 'signed', signature_name: 'Pat PCQI', signed_at: '2026-11-03T15:00:00Z', record_date: '2026-11-03', recorded_at: '2026-11-03T14:00:00Z', has_deviation: false,
    data: { instrument: 'pH meter', location: 'PH-01 / QC lab', method: '2-point 4.01/7.00', reference: 'Hanna lot 2311A ' + XSS, result: 'Slope 98.4%', range: '95 to 105%', pf: 'pass', next_due: '2026-12-03' } },
  // From the Daily GMP register template
  { id: 'k2', form_code: 'GMP-CAL-001', status: 'complete', record_date: '2026-10-02', recorded_at: '2026-10-02T14:00:00Z', has_deviation: true, deviation_notes: 'Within tolerance: fail',
    data: { instrument: 'pH meter', instrument_id: 'PH-01', reference: 'Buffer 7.00', as_found: 7.12, as_left: 7.01, tolerance_ok: 'fail', next_due: '2026-11-02', performed_by: 'Sam', operator: 'Sam' } },
  { id: 'k3', form_code: 'GMP-CAL-001', status: 'signed', signature_name: 'Pat PCQI', record_date: '2026-11-04', recorded_at: '2026-11-04T14:00:00Z', has_deviation: false,
    data: { instrument: 'Scale', location: 'Batching', result: '1000.0 g', pf: 'pass' } },
];

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<div id="cpg-cip" class="cpg"><div id="cip-sub"></div><div id="cip-body"></div></div>
<script>
window.glEsc = function(s){ return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){
  return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]; }); };
window.glBindPopupControls = function(w){ window.__bound = (window.__bound || 0) + 1; };
window.currentUser = { name: 'Test Printer' };
localStorage.setItem('gl_cache_compliance_records', JSON.stringify(${JSON.stringify(LOCAL)}));
var DATA = { compliance_records: ${JSON.stringify(CIP.concat(CAL))}, gmp_templates: [${JSON.stringify(CAL_TPL)}] };
function Q(t){ this.t = t; this.f = []; this.like = null; }
Q.prototype.select = function(){ return this; };
Q.prototype.order = function(){ return this; };
Q.prototype.limit = function(){ return this; };
Q.prototype.eq = function(k, v){ this.f.push([k, v]); return this; };
Q.prototype.ilike = function(k, v){ this.like = v.replace(/%/g, '').replace(/\\\\/g, '').toLowerCase(); return this; };
Q.prototype._rows = function(){
  var self = this;
  var rows = (DATA[this.t] || []).filter(function(r){ return self.f.every(function(f){ return r[f[0]] === f[1]; }); });
  if(self.like) rows = rows.filter(function(r){ return String(r.data.equipment).toLowerCase().indexOf(self.like) >= 0; });
  return rows;
};
Q.prototype.maybeSingle = function(){ return Promise.resolve({ data: this._rows()[0] || null, error: null }); };
Q.prototype.then = function(res, rej){ return Promise.resolve({ data: this._rows(), error: null }).then(res, rej); };
window.supa = { from: function(t){ return new Q(t); } };
<\/script>
<script src="/src/modules/production/compliance-print.js"><\/script>
<script src="/src/modules/production/cip-audit.js"><\/script>
<script src="/src/modules/production/gmp.js"><\/script></body>`;

const FILES = ['/src/modules/production/compliance-print.js', '/src/modules/production/cip-audit.js', '/src/modules/production/gmp.js', '/gl-print-log.css'];
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (FILES.indexOf(p) >= 0) {
    res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : 'text/javascript' });
    return res.end(fs.readFileSync(path.join(ROOT, p)));
  }
  res.writeHead(404); res.end();
});

async function popupOf(page, click) {
  const [pop] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }), click()]);
  await pop.waitForLoadState('domcontentloaded');
  const out = await pop.evaluate(() => ({
    text: document.body.innerText,
    imgs: document.querySelectorAll('img').length,
    css: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href),
    wide: document.body.classList.contains('wide'),
    recs: [...document.querySelectorAll('.rec')].map((r) => r.innerText),
    rows: [...document.querySelectorAll('table.log tbody tr')].map((r) => [...r.cells].map((c) => c.innerText)),
    heads: [...document.querySelectorAll('table.log thead th')].map((c) => c.innerText.toLowerCase()),
    failCells: [...document.querySelectorAll('td.fail')].map((c) => c.innerText),
  }));
  await pop.close();
  return out;
}

(async () => {
  console.log('Compliance Print / PDF\n');
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.getElementById('cpg-cip').classList.add('act'));
  await page.waitForSelector('#gl-cip-print', { timeout: 5000 });

  // ── CIP list ──
  const list = await popupOf(page, () => page.click('#gl-cip-print'));
  check('the CIP printout links its print stylesheet', list.css.some((h) => /\/gl-print-log\.css$/.test(h)), JSON.stringify(list.css));
  check('two saved cycles print, oldest first', list.recs.length === 2 && /FB6/.test(list.recs[0]) && /Filling Line 1/.test(list.recs[1]), list.recs.map((r) => r.slice(0, 60)).join(' | '));
  check('each cycle shows all 9 steps', list.recs.every((r) => /PRE-USE PAA/.test(r) && /Pre-Rinse/.test(r)));
  check('the failed cycle reads FAIL with its deviation and corrective action',
    /FAIL/.test(list.recs[0]) && /Step 4 temp 150°F/.test(list.recs[0]) && /Repeated caustic/.test(list.recs[0]), list.recs[0]);
  check('a skipped step reads SKIPPED', /SKIPPED/.test(list.recs[0]));
  check('the unsigned cycle has a blank signature line', /PCQI signature: _+/.test(list.recs[0]));
  check('a signed cycle shows who signed', /Pat PCQI on Nov 12, 2026/.test(list.recs[1]), list.recs[1].slice(-200));
  check('form notes on a passing cycle print as Notes, not as a Deviation',
    /Notes: Swapped PAA strip lot/.test(list.recs[1]) && !/Deviation/.test(list.recs[1]), list.recs[1].slice(-200));
  check('the cycle held only in this browser is left off, and the printout says so',
    !/Mix tank/.test(list.text) && /1 cycle is held in this browser only/.test(list.text), list.text.slice(0, 500));
  check('the header counts records, deviations and unsigned', /2 records · 1 with a deviation · 1 not signed/.test(list.text), list.text.slice(0, 400));
  check('script in an equipment name does not run or render as an element', list.imgs === 0 && !(await page.evaluate(() => window.__xss)));
  check('Print and Close are bound in the popup', (await page.evaluate(() => window.__bound)) >= 1);

  // ── CIP search, then print ──
  await page.fill('#gl-cip-search', 'filling');
  await page.press('#gl-cip-search', 'Enter');
  await page.waitForFunction(() => /cycles? for/.test(document.getElementById('cip-body').innerText), null, { timeout: 5000 });
  const searched = await popupOf(page, () => page.click('#gl-cip-print'));
  check('a searched tank prints only that tank', searched.recs.length === 1 && /Filling Line 1/.test(searched.recs[0]) && /Equipment matching “filling”/.test(searched.text), searched.text.slice(0, 300));

  // ── CIP single cycle from the detail ──
  await page.evaluate(() => window.glOpenCipDetail('c2'));
  const one = await popupOf(page, () => page.click('#gl-cipd-print'));
  check('the cycle detail prints that one cycle', one.recs.length === 1 && /CIP Cycle Record/.test(one.text) && /Filling Line 1/.test(one.recs[0]), one.text.slice(0, 300));
  await page.evaluate(() => { const d = document.getElementById('gl-cip-detail'); if (d) d.remove(); });

  // ── Calibration register ──
  await page.evaluate(() => window.glOpenGMPRegister('GMP-CAL-001'));
  await page.waitForSelector('#gl-gmp-reg-inst', { timeout: 5000 });
  const opts = await page.evaluate(() => [...document.querySelectorAll('#gl-gmp-reg-inst option')].map((o) => o.value));
  check('the instrument filter lists each instrument once', JSON.stringify(opts) === '["","pH meter","Scale"]', JSON.stringify(opts));
  await page.selectOption('#gl-gmp-reg-inst', 'pH meter');
  const onScreen = await page.evaluate(() => document.querySelectorAll('#gl-gmp-reg-rows tr').length);
  check('filtering to pH meter narrows the list on screen', onScreen === 2, String(onScreen));

  const cal = await popupOf(page, () => page.click('#gl-gmp-reg-print'));
  check('the calibration printout is landscape', cal.wide);
  check('the calibration printout is titled for the pH meter', /Calibration Verification · pH meter/.test(cal.text) && /Instrument: pH meter/.test(cal.text), cal.text.slice(0, 300));
  check('only pH meter checks print, oldest first',
    cal.rows.length === 2 && /Oct 2, 2026/.test(cal.rows[0][0]) && /Nov 3, 2026/.test(cal.rows[1][0]) && !/Scale/.test(cal.text), JSON.stringify(cal.rows));
  const col = (name) => cal.heads.indexOf(name);
  check('a Compliance-form record prints its location, method, result and range',
    cal.rows[1][col('id / location')] === 'PH-01 / QC lab' && cal.rows[1][col('method')] === '2-point 4.01/7.00' &&
    cal.rows[1][col('result')] === 'Slope 98.4%' && cal.rows[1][col('acceptable range')] === '95 to 105%', JSON.stringify(cal.rows[1]));
  check('a Daily GMP record prints its ID, as-found / as-left and who did it',
    cal.rows[0][col('id / location')] === 'PH-01' && cal.rows[0][col('result')] === 'As found 7.12, As left 7.01' && cal.rows[0][col('performed by')] === 'Sam', JSON.stringify(cal.rows[0]));
  check('next due is the calendar date entered, not a day early', cal.rows[1][col('next due')] === 'Dec 3, 2026', cal.rows[1][col('next due')]);
  check('the failed check reads FAIL', cal.failCells.indexOf('FAIL') >= 0 && cal.rows[0][col('pass / fail')] === 'FAIL', JSON.stringify(cal.failCells));
  check('signed and unsigned are both stated', cal.rows[1][col('pcqi signature')].indexOf('Pat PCQI') === 0 && cal.rows[0][col('pcqi signature')] === 'Not signed', JSON.stringify(cal.rows.map((r) => r[col('pcqi signature')])));
  check('script in a reference value does not render as an element', cal.imgs === 0 && /Hanna lot 2311A <img/.test(cal.text));

  await page.selectOption('#gl-gmp-reg-inst', '');
  const all = await popupOf(page, () => page.click('#gl-gmp-reg-print'));
  check('"All instruments" prints every calibration', all.rows.length === 3 && /All instruments/.test(all.text), JSON.stringify(all.rows.map((r) => r[1])));

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
