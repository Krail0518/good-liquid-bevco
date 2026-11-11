/*
 * atp-swab-report.test.cjs — ATP swab log + the customer report.
 *
 * WHAT THIS PROVES
 * ----------------
 * The real compliance.js + atp-swabs.js in a browser, against an in-memory
 * stand-in for Supabase:
 *
 *   TENANT ISOLATION (the report is read by a client; clients compete)
 *   - a swab linked to ANOTHER client's run never reaches this client's report,
 *     even on a day both clients ran
 *   - a record whose client_id names another client is excluded even if it
 *     points at one of this client's runs
 *   - facility-wide swabs appear only on this client's production days, and
 *     only when that option is ticked
 *   - the other client's name and run name appear nowhere in the report
 *   - operator notes are left out unless asked for
 *   - "signed only" leaves unsigned records out and says how many
 *
 *   CORRECTNESS
 *   - RLU is classified PASS / CAUTION / FAIL against the configured limits
 *   - the log form saves to compliance_records with the run's client_id, the
 *     limits in force, and a deviation only when a FAIL is left unresolved
 *   - a re-swab without a corrective action is refused
 *
 *   ESCAPING (CLAUDE.md rule 5)
 *   - script in a surface name, corrective action, run name or client name
 *     does not execute in the tab, the builder or the report
 *
 * Run:  NODE_PATH=… node tests/atp-swab-report.test.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = 8952;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const XSS = '<img src=x onerror="window.__xss=1">';
const ACME = 'c-acme', RIVAL = 'c-rival';
const CLIENTS = [{ id: ACME, name: 'Acme Soda ' + XSS }, { id: RIVAL, name: 'RivalCo Beverages' }];
const RUNS = [
  { id: 'run-a1', client_id: ACME,  client_name: 'Acme Soda', run_name: 'Acme Lime 12oz ' + XSS, lot_number: 'L-A1', format: '12oz can', scheduled_start_date: '2026-10-06', scheduled_end_date: '2026-10-07' },
  { id: 'run-r1', client_id: RIVAL, client_name: 'RivalCo Beverages', run_name: 'RivalCo Secret Cola', lot_number: 'L-R1', scheduled_start_date: '2026-10-06' },
  { id: 'run-legacy', client_id: null, client_name: 'Acme Soda ' + XSS, run_name: 'Acme legacy run', scheduled_date: '2026-10-20' },
];
const TH = { pass_max: 150, fail_above: 300, unit: 'RLU' };
function rec(id, run_id, date, status, points, extra) {
  return Object.assign({
    id, form_code: 'GMP-ATP-001', status, run_id, client_id: null, record_date: date,
    recorded_at: date + 'T13:00:00Z', signed_at: status === 'signed' ? date + 'T15:00:00Z' : null,
    signature_name: status === 'signed' ? 'Pat PCQI' : null,
    data: { swab_at: date + 'T12:00:00Z', timing: 'preop', run_id, operator: 'Op', device: 'EnSURE Touch', thresholds: TH, points, notes: null },
  }, extra || {});
}
const P = (location, rlu, result, extra) => Object.assign({ location, zone: '1', rlu, result, reswab_rlu: null, reswab_result: null, final_result: result, corrective_action: null }, extra || {});
const RECORDS = [
  rec('a-linked', 'run-a1', '2026-10-06', 'signed', [P('Filler nozzles ' + XSS, 40, 'pass'), P('Filler bowl', 420, 'fail', { reswab_rlu: 60, reswab_result: 'pass', final_result: 'pass', corrective_action: 'Re-cleaned ' + XSS })]),
  rec('r-linked', 'run-r1', '2026-10-06', 'signed', [P('RivalCo-only valve', 10, 'pass')]),
  // Points at Acme's run but stamped with Rival's client_id: must not leak.
  rec('mismatch', 'run-a1', '2026-10-07', 'signed', [P('Mismatched record', 11, 'pass')], { client_id: RIVAL }),
  rec('fac-proday', null, '2026-10-07', 'signed', [P('Mix tank interior', 200, 'caution')]),
  rec('fac-otherday', null, '2026-10-12', 'signed', [P('Other-day swab', 30, 'pass')]),
  rec('a-unsigned', 'run-a1', '2026-10-07', 'draft', [P('Unsigned point', 20, 'pass')]),
  rec('a-legacy', 'run-legacy', '2026-10-20', 'signed', [P('Legacy surface', 90, 'pass')]),
];
RECORDS[0].data.notes = 'Ran right after RivalCo Secret Cola';

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<div id="cpg-compliance" class="cpg act"><div id="comp-body"></div></div>
<div id="holds-body"></div>
<script>
window.glEsc = function(s){ if(s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
window.currentUser = { id: 'u-staff', name: 'Sam Staff', email: 'sam@example.com' };
window.clients = ${JSON.stringify(CLIENTS)};
window.glProductionRuns = ${JSON.stringify(RUNS)}.map(function(r){
  // Put the Acme run "today" for the log form's run picker.
  return r.id === 'run-a1' ? Object.assign({}, r, { scheduled_start_date: new Date().toISOString().slice(0,10) }) : r;
});
window.addNotification = function(){};
window.glAudit = function(a, t, d){ (window.__audit = window.__audit || []).push([a, t, d]); };
window.glBindPopupControls = function(){};
var DB = { production_runs: ${JSON.stringify(RUNS)}, compliance_records: ${JSON.stringify(RECORDS)}, clients: ${JSON.stringify(CLIENTS)}, compliance_tasks: [], hold_tags: [] };
window.__inserts = [];
function Q(t){ this.t = t; this.f = []; this.op = 'select'; this.row = null; this.one = false; }
['select','order','limit'].forEach(function(m){ Q.prototype[m] = function(){ return this; }; });
Q.prototype.eq  = function(k,v){ this.f.push(function(r){ return r[k] === v; }); return this; };
Q.prototype.neq = function(k,v){ this.f.push(function(r){ return r[k] !== v; }); return this; };
Q.prototype.gte = function(k,v){ this.f.push(function(r){ return r[k] >= v; }); return this; };
Q.prototype.lte = function(k,v){ this.f.push(function(r){ return r[k] <= v; }); return this; };
Q.prototype.in  = function(k,v){ this.f.push(function(r){ return v.indexOf(r[k]) >= 0; }); return this; };
Q.prototype.is  = function(k,v){ this.f.push(function(r){ return (r[k] == null) === (v === null); }); return this; };
Q.prototype.insert = function(rows){ this.op = 'insert'; this.row = rows[0]; return this; };
Q.prototype.update = function(p){ this.op = 'update'; this.row = p; return this; };
Q.prototype.single = function(){ this.one = true; return this; };
Q.prototype.maybeSingle = Q.prototype.single;
Q.prototype.then = function(res, rej){
  var self = this, tbl = DB[self.t] = DB[self.t] || [], out;
  if(self.op === 'insert'){
    var r = Object.assign({ id: 'new-' + (tbl.length + 1) }, self.row);
    tbl.push(r); window.__inserts.push([self.t, r]); out = r;
  } else {
    var rows = tbl.filter(function(r){ return self.f.every(function(f){ return f(r); }); });
    if(self.op === 'update') rows.forEach(function(r){ Object.assign(r, self.row); });
    out = self.one ? rows[0] || null : rows;
  }
  return Promise.resolve({ data: out, error: null }).then(res, rej);
};
window.supa = { from: function(t){ return new Q(t); } };
<\/script>
<script src="/src/modules/production/compliance.js"><\/script>
<script src="/src/modules/production/atp-swabs.js"><\/script></body>`;

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const ok = { '/src/modules/production/compliance.js': 'text/javascript', '/src/modules/production/atp-swabs.js': 'text/javascript', '/gl-print-atp-report.css': 'text/css' };
  if (ok[p]) { res.writeHead(200, { 'Content-Type': ok[p] }); return res.end(fs.readFileSync(path.join(ROOT, p))); }
  res.writeHead(404); res.end();
});

(async () => {
  console.log('ATP swab log + customer report\n');
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.glAtpSelectForClient === 'function' && !!window.glComplianceForms, null, { timeout: 5000 });

  // ── classification ──
  const cls = await page.evaluate(() => [0, 150, 151, 300, 301, '', 'x'].map((v) => window.glAtpClassify(v, { pass: 150, fail: 300 })));
  check('RLU classified PASS ≤150, CAUTION 151–300, FAIL >300, blank/garbage → none',
    JSON.stringify(cls) === JSON.stringify(['pass', 'pass', 'caution', 'caution', 'fail', null, null]), JSON.stringify(cls));

  // ── the isolation filter ──
  const sel = await page.evaluate(({ RECORDS, RUNS, ACME }) => {
    const acmeRuns = RUNS.filter((r) => r.client_id === ACME || r.id === 'run-legacy');
    const ids = (s) => ({ linked: s.linked.map((r) => r.id).sort(), facility: s.facility.map((r) => r.id).sort(), unsigned: s.unsignedMatching });
    return {
      full: ids(window.glAtpSelectForClient(RECORDS, ACME, acmeRuns, { includeFacility: true, signedOnly: true })),
      noFac: ids(window.glAtpSelectForClient(RECORDS, ACME, acmeRuns, { includeFacility: false, signedOnly: true })),
      unsigned: ids(window.glAtpSelectForClient(RECORDS, ACME, acmeRuns, { includeFacility: true, signedOnly: false })),
      // A caller that wrongly passes the rival's run in still cannot leak it.
      poisoned: ids(window.glAtpSelectForClient(RECORDS, ACME, RUNS, { includeFacility: true, signedOnly: true })),
    };
  }, { RECORDS, RUNS, ACME });
  check("another client's run is never included, even on a shared production day", sel.full.linked.indexOf('r-linked') < 0, JSON.stringify(sel.full));
  check("a record stamped with another client's client_id is excluded", sel.full.linked.indexOf('mismatch') < 0, JSON.stringify(sel.full));
  check("this client's linked runs are included (incl. a legacy name-only run)", JSON.stringify(sel.full.linked) === '["a-legacy","a-linked"]', JSON.stringify(sel.full));
  check('facility-wide swabs only on this client\'s production days', JSON.stringify(sel.full.facility) === '["fac-proday"]', JSON.stringify(sel.full));
  check('facility-wide swabs omitted when the option is off', sel.noFac.facility.length === 0, JSON.stringify(sel.noFac));
  check('signed-only leaves the draft out and counts it', sel.full.unsigned === 1 && sel.full.linked.indexOf('a-unsigned') < 0, JSON.stringify(sel.full));
  check('unticking signed-only includes the draft', sel.unsigned.linked.indexOf('a-unsigned') >= 0, JSON.stringify(sel.unsigned));
  check("passing the rival's run in by mistake still does not leak it", sel.poisoned.linked.indexOf('r-linked') < 0, JSON.stringify(sel.poisoned));

  // ── the tab ──
  await page.evaluate(async () => { await window.glRenderAtpTab(document.getElementById('comp-body')); });
  const tab = await page.evaluate(() => ({ text: document.getElementById('comp-body').innerText, xss: window.__xss === 1 || !!document.querySelector('#comp-body img') }));
  check('the tab lists records and KPIs', /Customer report/.test(tab.text) && /Log ATP swabs/.test(tab.text), tab.text.slice(0, 300));
  check('script in stored text does not run in the tab', !tab.xss);

  // ── the log form ──
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-atp-points .gl-atp-row');
  const runOpt = await page.evaluate(() => [...document.querySelectorAll('#gl-cf-atp-run option')].map((o) => o.value));
  check("the run picker offers recent runs", runOpt.indexOf('run-a1') >= 0, JSON.stringify(runOpt));
  await page.selectOption('#gl-cf-atp-run', 'run-a1');
  const rows = await page.$$('#gl-atp-points .gl-atp-row');
  await rows[0].$eval('.gl-atp-rlu', (e) => { e.value = '42'; e.dispatchEvent(new Event('input')); });
  await rows[1].$eval('.gl-atp-rlu', (e) => { e.value = '520'; e.dispatchEvent(new Event('input')); });
  await rows[1].$eval('.gl-atp-rerlu', (e) => { e.value = '410'; e.dispatchEvent(new Event('input')); });
  await rows[2].$eval('.gl-atp-loc', (e) => { e.value = ''; });   // blank row is ignored
  const badgeTxt = await rows[1].$eval('.gl-atp-res', (e) => e.innerText);
  check('the result badge updates live (FAIL → FAIL)', /FAIL.*FAIL/s.test(badgeTxt), badgeTxt);
  await page.click('.gl-cf-sign');
  const err1 = await page.$eval('#gl-atp-err', (e) => e.style.display !== 'none' ? e.innerText : '');
  check('a re-swab without a corrective action is refused', /corrective action/i.test(err1), err1);
  const before = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_records').length);
  check('nothing saved while the form is invalid', before === 0, String(before));
  await rows[1].$eval('.gl-atp-ca', (e) => { e.value = 'Re-cleaned and re-sanitized'; });
  await page.click('.gl-cf-sign');
  await page.waitForFunction(() => window.__inserts.some((i) => i[0] === 'compliance_records'), null, { timeout: 5000 });
  const saved = await page.evaluate(() => window.__inserts.find((i) => i[0] === 'compliance_records')[1]);
  check('saved as GMP-ATP-001, signed, with the run and its client_id', saved.form_code === 'GMP-ATP-001' && saved.status === 'signed' && saved.run_id === 'run-a1' && saved.client_id === ACME, JSON.stringify(saved).slice(0, 300));
  check('two points saved (blank row ignored), classified, limits recorded',
    saved.data.points.length === 2 && saved.data.points[0].result === 'pass' && saved.data.points[1].result === 'fail' &&
    saved.data.points[1].final_result === 'fail' && saved.data.thresholds.pass_max === 150 && saved.data.thresholds.fail_above === 300,
    JSON.stringify(saved.data));
  check('an unresolved FAIL is recorded as a deviation', saved.has_deviation === true && /Filler bowl 410 RLU/.test(saved.deviation_notes || ''), saved.deviation_notes);

  // ── the report, end to end ──
  await page.evaluate(() => window.glOpenAtpReport());
  await page.waitForSelector('#gl-cf-atpr-client');
  await page.fill('#gl-cf-atpr-from', '2026-10-01');
  await page.fill('#gl-cf-atpr-to', '2026-10-31');
  await page.selectOption('#gl-cf-atpr-client', ACME);
  await page.waitForFunction(() => /swab session/.test(document.getElementById('atpr-preview').innerText), null, { timeout: 5000 });
  const prev = await page.evaluate(() => document.getElementById('atpr-preview').innerText);
  check('the builder previews what will be sent, and flags the unsigned record', /3 swab sessions/.test(prev) && /1 matching record is not PCQI-signed/.test(prev), prev);
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#atpr-go')]);
  await popup.waitForFunction(() => /ATP Swab Verification Report/.test(document.body && document.body.innerText || ''), null, { timeout: 5000 });
  const rep = await popup.evaluate(() => ({ html: document.documentElement.outerHTML, text: document.body.innerText, xss: window.__xss === 1 || window.opener.__xss === 1, imgs: [...document.querySelectorAll('img')].map((i) => i.getAttribute('src')) }));
  check('the report is addressed to the client', /Prepared for/.test(rep.text) && /Acme Soda/.test(rep.text), rep.text.slice(0, 300));
  check("the other client's name appears nowhere", !/RivalCo/i.test(rep.html), (rep.html.match(/.{60}RivalCo.{60}/i) || [''])[0]);
  check("the other client's swab surfaces appear nowhere", !/RivalCo-only valve|Mismatched record|Other-day swab/.test(rep.html));
  check('operator notes are left out by default', !/Ran right after/.test(rep.html));
  check("this client's runs, lots and swabs are there", /Lot L-A1/.test(rep.text) && /Filler bowl/.test(rep.text) && /Legacy surface/.test(rep.text) && /Mix tank interior/.test(rep.text), rep.text.slice(0, 800));
  check('acceptance criteria are stated', /PASS\s*≤ 150 RLU/.test(rep.text) && /FAIL\s*> 300 RLU/.test(rep.text));
  check('script in client, run, surface and corrective-action text does not run', !rep.xss && rep.imgs.every((s) => /gl-logo\.jpg$/.test(s)), JSON.stringify(rep.imgs));
  const aud = await page.evaluate(() => (window.__audit || []).find((a) => a[0] === 'atp_report_generated'));
  check('generating a report is audited', !!aud && aud[1] === ACME, JSON.stringify(aud));
  await popup.close();

  // Notes opt-in
  await page.check('#atpr-notes');
  const [popup2] = await Promise.all([ctx.waitForEvent('page'), page.click('#atpr-go')]);
  await popup2.waitForFunction(() => /ATP Swab Verification Report/.test(document.body && document.body.innerText || ''), null, { timeout: 5000 });
  const rep2 = await popup2.evaluate(() => document.body.innerText);
  check('operator notes appear only when asked for', /Ran right after/.test(rep2));
  await popup2.close();

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
