/*
 * atp-swab-report.test.cjs — ATP testing module + the customer PDF report.
 *
 * WHAT THIS PROVES
 * ----------------
 * The real compliance.js + atp-swabs.js in a browser, against an in-memory
 * stand-in for Supabase and the same jsPDF the CRM loads:
 *
 *   LIMITS (configurable by test type and location, never assumed)
 *   - no rules → no result, and the record cannot be signed
 *   - the most specific rule wins: equipment+location > location > equipment > type
 *   - location matching ignores case; test types never share limits
 *   - the limits editor refuses a fail limit below the pass limit and duplicates,
 *     and saves through glSaveAppSetting (org-wide), reporting a rejection
 *
 *   LOG FORM
 *   - equipment is picked from the same cip_equipment list as the CIP log,
 *     including "+ Add new equipment…"
 *   - the four Hygiena test types are offered
 *   - each test saves equipment, location, type, RLU, the limits that applied,
 *     result, corrective action and retest; a retest without a corrective
 *     action, or a FAIL without one on signing, is refused
 *   - an unresolved FAIL is a deviation; the run's client_id is stored
 *
 *   TENANT ISOLATION (the report is read by a client; clients compete)
 *   - another client's run, a record stamped with another client_id, and
 *     facility tests on days the client did not run never reach the report
 *   - the downloaded PDF never contains the other client's name or tests
 *   - operator notes are left out unless asked for
 *
 *   ESCAPING (CLAUDE.md rule 5)
 *   - script in equipment, location, corrective action or client name does
 *     not execute in the tab or the form
 *
 * Run:  NODE_PATH=… node tests/atp-swab-report.test.cjs   (needs playwright + jspdf@2.5.1)
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

let JSPDF = null;
try { JSPDF = require.resolve('jspdf/dist/jspdf.umd.min.js'); } catch (e) { JSPDF = null; }

const XSS = '<img src=x onerror="window.__xss=1">';
const ACME = 'c-acme', RIVAL = 'c-rival';
const CLIENTS = [{ id: ACME, name: 'Acme Soda Co' }, { id: RIVAL, name: 'RivalCo Beverages' }];
const RUNS = [
  { id: 'run-a1', client_id: ACME,  client_name: 'Acme Soda Co', run_name: 'Acme Lime Seltzer', lot_number: 'L-A1', format: '12oz can', scheduled_start_date: '2026-10-06', scheduled_end_date: '2026-10-07' },
  { id: 'run-r1', client_id: RIVAL, client_name: 'RivalCo Beverages', run_name: 'RivalCo Secret Cola', lot_number: 'L-R1', scheduled_start_date: '2026-10-06' },
  { id: 'run-legacy', client_id: null, client_name: 'Acme Soda Co', run_name: 'Acme legacy run', scheduled_date: '2026-10-20' },
];
const RULES = [
  { test_type: 'ultrasnap', equipment: null, location: null, pass_max: 10, fail_above: 30 },
  { test_type: 'ultrasnap', equipment: null, location: 'Filler nozzles', pass_max: 5, fail_above: 15 },
  { test_type: 'ultrasnap', equipment: 'Filler 1', location: 'Filler nozzles', pass_max: 3, fail_above: 10 },
  { test_type: 'ultrasnap', equipment: 'Brite Tank 3', location: null, pass_max: 8, fail_above: 20 },
  { test_type: 'aquasnap_total', equipment: null, location: 'CIP final rinse', pass_max: 50, fail_above: 100 },
];
const LIM = { pass_max: 10, fail_above: 30, basis: 'UltraSnap · any equipment · any location' };
function T(equipment, location, rlu, result, extra) {
  return Object.assign({ equipment, location, test_type: 'ultrasnap', test_name: 'UltraSnap', rlu, limits: LIM, result, corrective_action: null, retest_rlu: null, retest_result: null, final_result: result }, extra || {});
}
function rec(id, run_id, date, status, tests, extra) {
  return Object.assign({
    id, form_code: 'GMP-ATP-001', status, run_id, client_id: null, record_date: date,
    recorded_at: date + 'T13:00:00Z', signed_at: status === 'signed' ? date + 'T15:00:00Z' : null,
    signature_name: status === 'signed' ? 'Pat PCQI' : null,
    data: { tested_at: date + 'T12:00:00Z', timing: 'preop', run_id, operator: 'Op', luminometer: 'EnSURE Touch', tests, notes: null },
  }, extra || {});
}
const RECORDS = [
  rec('a-linked', 'run-a1', '2026-10-06', 'signed', [T('Filler 1', 'Filler nozzles', 4, 'pass'), T('Filler 1', 'Filler bowl', 42, 'fail', { retest_rlu: 6, retest_result: 'pass', final_result: 'pass', corrective_action: 'Re-cleaned filler bowl' })]),
  rec('r-linked', 'run-r1', '2026-10-06', 'signed', [T('Filler 1', 'RivalCo-only valve', 1, 'pass')]),
  rec('mismatch', 'run-a1', '2026-10-07', 'signed', [T('Filler 1', 'Mismatched record', 1, 'pass')], { client_id: RIVAL }),
  rec('fac-proday', null, '2026-10-07', 'signed', [T('Brite Tank 3', 'Tank interior wall', 22, 'caution')]),
  rec('fac-otherday', null, '2026-10-12', 'signed', [T('Brite Tank 3', 'Other-day test', 3, 'pass')]),
  rec('a-unsigned', 'run-a1', '2026-10-07', 'draft', [T('Filler 1', 'Unsigned point', 2, 'pass')]),
  rec('a-legacy', 'run-legacy', '2026-10-20', 'signed', [T('Filler 1', 'Legacy surface', 9, 'pass')]),
  rec('xss', null, '2026-11-01', 'draft', [T('Evil ' + XSS, 'Loc ' + XSS, 1, 'pass', { corrective_action: 'CA ' + XSS })]),
];
RECORDS[0].data.notes = 'Ran right after RivalCo Secret Cola';

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<div id="cpg-compliance" class="cpg act"><div id="comp-body"></div></div>
<div id="holds-body"></div>
<script src="/jspdf.umd.min.js"><\/script>
<script>
window.ensureJsPdf = function(){ return Promise.resolve(window.jspdf.jsPDF); };
window.jspdf.jsPDF.API.save = function(name){ window.__savedName = name; window.__savedPdf = this.output(); return this; };
window.glEsc = function(s){ if(s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
localStorage.setItem('gl_cip_equipment', JSON.stringify(['Filler 1','Brite Tank 3']));
window.currentUser = { id: 'u-staff', name: 'Sam Staff', email: 'sam@example.com' };
window.clients = ${JSON.stringify(CLIENTS)};
window.GL_APP_SETTINGS = {};
window.__saveOk = true;
window.glSaveAppSetting = async function(k, v){ if(!window.__saveOk) return false; window.GL_APP_SETTINGS[k] = v; return true; };
window.glProductionRuns = ${JSON.stringify(RUNS)}.map(function(r){
  return r.id === 'run-a1' ? Object.assign({}, r, { scheduled_start_date: new Date().toISOString().slice(0,10) }) : r;
});
window.addNotification = function(){};
window.glAudit = function(a, t, d){ (window.__audit = window.__audit || []).push([a, t, d]); };
var DB = { production_runs: ${JSON.stringify(RUNS)}, compliance_records: ${JSON.stringify(RECORDS)}, clients: ${JSON.stringify(CLIENTS)},
  compliance_tasks: [], hold_tags: [], cip_equipment: [{ name:'Filler 1', active:true }, { name:'Brite Tank 3', active:true }] };
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
Q.prototype.upsert = function(row){ this.op = 'upsert'; this.row = row; return this; };
Q.prototype.update = function(p){ this.op = 'update'; this.row = p; return this; };
Q.prototype.single = function(){ this.one = true; return this; };
Q.prototype.maybeSingle = Q.prototype.single;
Q.prototype.then = function(res, rej){
  var self = this, tbl = DB[self.t] = DB[self.t] || [], out;
  if(self.op === 'insert' || self.op === 'upsert'){
    var r = Object.assign({ id: 'new-' + (tbl.length + 1), active: true }, self.row);
    tbl.push(r); window.__inserts.push([self.t, r]); out = self.one ? r : [r];
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
  if (p === '/jspdf.umd.min.js' && JSPDF) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(JSPDF)); }
  const ok = { '/src/modules/production/compliance.js': 'text/javascript', '/src/modules/production/atp-swabs.js': 'text/javascript', '/gl-logo.jpg': 'image/jpeg' };
  if (ok[p]) { res.writeHead(200, { 'Content-Type': ok[p] }); return res.end(fs.readFileSync(path.join(ROOT, p))); }
  res.writeHead(404); res.end();
});

(async () => {
  console.log('ATP testing module + customer PDF report\n');
  if (!JSPDF) { check('jspdf is resolvable from NODE_PATH', false, 'npm install jspdf@2.5.1 next to playwright'); process.exit(1); }
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Seamer 2') : d.accept());
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.glAtpSelectForClient === 'function' && !!window.glComplianceForms, null, { timeout: 5000 });

  // ── limits: pure ──
  const lim = await page.evaluate((RULES) => {
    const f = (t, e, l) => { const x = window.glAtpLimitFor(RULES, t, e, l); return x ? x.pass_max + '/' + x.fail_above : null; };
    return {
      none: window.glAtpLimitFor([], 'ultrasnap', 'Filler 1', 'Filler nozzles'),
      both: f('ultrasnap', 'Filler 1', 'Filler nozzles'),
      locOnly: f('ultrasnap', 'Brite Tank 3', 'filler NOZZLES'),
      equipOnly: f('ultrasnap', 'Brite Tank 3', 'Tank interior wall'),
      typeOnly: f('ultrasnap', 'Seamer 2', 'Chucks'),
      otherType: f('supersnap', 'Filler 1', 'Filler nozzles'),
      liquid: f('aquasnap_total', 'Brite Tank 3', 'CIP final rinse'),
      liquidElsewhere: f('aquasnap_total', 'Brite Tank 3', 'Process water'),
      cls: [0, 10, 11, 30, 31].map((v) => window.glAtpClassify(v, { pass_max: 10, fail_above: 30 })),
      noLim: window.glAtpClassify(5, null),
      types: window.glAtpTestTypes.map((t) => t.name),
    };
  }, RULES);
  check('the four Hygiena test types', JSON.stringify(lim.types) === '["UltraSnap","SuperSnap","AquaSnap Total","AquaSnap Free"]', JSON.stringify(lim.types));
  check('no rules → no limit (nothing assumed)', lim.none === null && lim.noLim === null);
  check('equipment + location rule beats the rest', lim.both === '3/10', lim.both);
  check('location rule beats equipment rule; location ignores case', lim.locOnly === '5/15', lim.locOnly);
  check('equipment rule applies when no location rule matches', lim.equipOnly === '8/20', lim.equipOnly);
  check('test-type rule is the fallback', lim.typeOnly === '10/30', lim.typeOnly);
  check('one test type never borrows another\'s limits', lim.otherType === null, lim.otherType);
  check('liquid limits apply only at their sampling location', lim.liquid === '50/100' && lim.liquidElsewhere === null, lim.liquid + ' ' + lim.liquidElsewhere);
  check('PASS ≤ pass, CAUTION between, FAIL > fail', JSON.stringify(lim.cls) === '["pass","pass","caution","caution","fail"]', JSON.stringify(lim.cls));

  // ── form with NO limits configured: cannot sign ──
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-atp-tests .gl-atp-row');
  const noLimBanner = await page.evaluate(() => document.getElementById('gl-comp-modal').innerText);
  check('form warns when no limits are set up', /No ATP limits are set up yet/.test(noLimBanner));
  let row = (await page.$$('#gl-atp-tests .gl-atp-row'))[0];
  await (await row.$('.gl-atp-equip')).selectOption('Filler 1');
  await (await row.$('.gl-atp-loc')).fill('Filler nozzles');
  await (await row.$('.gl-atp-rlu')).fill('2');
  const nl = await row.$eval('.gl-atp-res', (e) => e.innerText);
  check('a reading with no limit shows NO LIMIT', /No limit set/.test(nl) && /NO LIMIT/.test(nl), nl);
  await page.click('.gl-cf-sign');
  const e0 = await page.$eval('#gl-atp-err', (e) => e.innerText);
  check('signing without a limit is refused', /no ATP limit is set/.test(e0), e0);
  await page.evaluate(() => document.getElementById('gl-comp-modal').remove());

  // ── limits editor ──
  await page.evaluate(() => window.glOpenAtpLimits());
  await page.waitForSelector('.gl-atpl-row');
  async function setRule(i, t, eq, loc, p, f) {
    const rows = await page.$$('.gl-atpl-row');
    const r = rows[i];
    await (await r.$('.gl-atpl-type')).selectOption(t);
    await (await r.$('.gl-atpl-equip')).selectOption(eq);
    await (await r.$('.gl-atpl-loc')).fill(loc);
    await (await r.$('.gl-atpl-pass')).fill(String(p));
    await (await r.$('.gl-atpl-fail')).fill(String(f));
  }
  const eqOpts = await page.$$eval('.gl-atpl-equip option', (o) => o.map((x) => x.value));
  check('limit rules pick equipment from the CIP equipment list', eqOpts.indexOf('Filler 1') >= 0 && eqOpts.indexOf('Brite Tank 3') >= 0, JSON.stringify(eqOpts));
  await setRule(0, 'ultrasnap', '', '', 20, 10);
  await page.click('#gl-atpl-save');
  let le = await page.$eval('#gl-atpl-err', (e) => e.innerText);
  check('a fail limit below the pass limit is refused', /at or above the pass limit/.test(le), le);
  await setRule(0, 'ultrasnap', '', '', 10, 30);
  await page.click('#gl-atpl-add'); await setRule(1, 'ultrasnap', '', '', 10, 30);
  await page.click('#gl-atpl-save');
  le = await page.$eval('#gl-atpl-err', (e) => e.innerText);
  check('a duplicate rule is refused', /duplicates rule 1/.test(le), le);
  await setRule(1, 'ultrasnap', 'Filler 1', 'Filler nozzles', 3, 10);
  await page.click('#gl-atpl-add'); await setRule(2, 'aquasnap_total', '', 'CIP final rinse', 50, 100);
  await page.evaluate(() => { window.__saveOk = false; });
  await page.click('#gl-atpl-save');
  le = await page.$eval('#gl-atpl-err', (e) => e.innerText);
  const notStored = await page.evaluate(() => !window.GL_APP_SETTINGS.atp_limits);
  check('a server rejection is reported, not shown as saved', /NOT saved/.test(le) && notStored, le);
  await page.evaluate(() => { window.__saveOk = true; });
  await page.click('#gl-atpl-save');
  await page.waitForFunction(() => !document.getElementById('gl-comp-modal'), null, { timeout: 5000 });
  const saved = await page.evaluate(() => window.GL_APP_SETTINGS.atp_limits);
  check('limits saved org-wide as 3 rules', saved && saved.rules.length === 3 && saved.rules[1].equipment === 'Filler 1' && saved.rules[1].location === 'Filler nozzles', JSON.stringify(saved));

  // ── log form with limits ──
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-atp-tests .gl-atp-row');
  const typeOpts = await page.$$eval('.gl-atp-type option', (o) => o.map((x) => x.textContent));
  check('the test-type dropdown lists the Hygiena tests', JSON.stringify(typeOpts) === '["UltraSnap","SuperSnap","AquaSnap Total","AquaSnap Free"]', JSON.stringify(typeOpts));
  const eqForm = await page.$$eval('.gl-atp-equip option', (o) => o.map((x) => x.value));
  check('equipment dropdown = CIP list + add/edit, like the CIP log', JSON.stringify(eqForm) === '["","Filler 1","Brite Tank 3","__add__","__edit__"]', JSON.stringify(eqForm));
  await page.selectOption('#gl-cf-atp-run', 'run-a1');
  row = (await page.$$('#gl-atp-tests .gl-atp-row'))[0];
  await (await row.$('.gl-atp-equip')).selectOption('__add__');
  await page.waitForFunction(() => document.querySelector('.gl-atp-equip').value === 'Seamer 2', null, { timeout: 5000 });
  const added = await page.evaluate(() => (window.__inserts.find((i) => i[0] === 'cip_equipment') || [])[1]);
  check('"+ Add new equipment…" adds to the shared cip_equipment list', added && added.name === 'Seamer 2', JSON.stringify(added));
  await (await row.$('.gl-atp-equip')).selectOption('Filler 1');
  await (await row.$('.gl-atp-loc')).fill('Filler nozzles');
  await (await row.$('.gl-atp-rlu')).fill('12');
  await (await row.$('.gl-atp-rerlu')).fill('2');
  const r1 = await row.$eval('.gl-atp-res', (e) => e.innerText);
  check('the applicable limit and result show live (3/10 → FAIL, retest PASS)', /Pass <= 3 \/ Fail > 10/.test(r1) && /FAIL/.test(r1) && /retest\s*PASS/.test(r1), r1);
  await page.click('#gl-atp-add');
  const rows2 = await page.$$('#gl-atp-tests .gl-atp-row');
  const carried = await rows2[1].$eval('.gl-atp-equip', (e) => e.value);
  check('a new test starts from the previous equipment', carried === 'Filler 1', carried);
  await (await rows2[1].$('.gl-atp-equip')).selectOption('Brite Tank 3');
  await (await rows2[1].$('.gl-atp-type')).selectOption('aquasnap_total');
  const listAttr = await rows2[1].$eval('.gl-atp-loc', (e) => e.getAttribute('list'));
  check('liquid tests suggest liquid sampling points', listAttr === 'gl-atp-locs-liquid', listAttr);
  await (await rows2[1].$('.gl-atp-loc')).fill('CIP final rinse');
  await (await rows2[1].$('.gl-atp-rlu')).fill('140');
  await page.click('.gl-cf-sign');
  let err = await page.$eval('#gl-atp-err', (e) => e.innerText);
  check('a retest without a corrective action is refused', /Test 1: record the corrective action/.test(err), err);
  check('a FAIL without a corrective action cannot be signed', /Test 2: a FAIL needs a corrective action/.test(err), err);
  check('nothing saved while invalid', await page.evaluate(() => !window.__inserts.some((i) => i[0] === 'compliance_records')));
  await (await row.$('.gl-atp-ca')).fill('Re-cleaned nozzles');
  await (await rows2[1].$('.gl-atp-ca')).fill('Re-ran CIP, retest pending');
  await page.click('.gl-cf-sign');
  await page.waitForFunction(() => window.__inserts.some((i) => i[0] === 'compliance_records'), null, { timeout: 5000 });
  const sv = await page.evaluate(() => window.__inserts.find((i) => i[0] === 'compliance_records')[1]);
  const t0 = sv.data.tests[0], t1 = sv.data.tests[1];
  check('saved signed GMP-ATP-001 with the run and its client_id', sv.form_code === 'GMP-ATP-001' && sv.status === 'signed' && sv.run_id === 'run-a1' && sv.client_id === ACME, JSON.stringify(sv).slice(0, 200));
  check('session records operator, luminometer and date/time', sv.data.operator === 'Sam Staff' && sv.data.luminometer === 'EnSURE Touch' && !!sv.data.tested_at, JSON.stringify(sv.data).slice(0, 300));
  check('test 1: equipment, location, type, RLU, limits, result, CA, retest',
    t0.equipment === 'Filler 1' && t0.location === 'Filler nozzles' && t0.test_type === 'ultrasnap' && t0.rlu === 12 &&
    t0.limits.pass_max === 3 && t0.limits.fail_above === 10 && t0.result === 'fail' && t0.corrective_action === 'Re-cleaned nozzles' &&
    t0.retest_rlu === 2 && t0.retest_result === 'pass' && t0.final_result === 'pass', JSON.stringify(t0));
  check('test 2: AquaSnap Total judged against its own location limit', t1.test_type === 'aquasnap_total' && t1.limits.pass_max === 50 && t1.result === 'fail', JSON.stringify(t1));
  check('the unresolved FAIL is a deviation; the corrected one is not', sv.has_deviation === true && /Brite Tank 3 \/ CIP final rinse 140 RLU/.test(sv.deviation_notes) && !/Filler nozzles/.test(sv.deviation_notes), sv.deviation_notes);

  // ── isolation filter ──
  const sel = await page.evaluate(({ RECORDS, RUNS, ACME }) => {
    const acmeRuns = RUNS.filter((r) => r.client_id === ACME || r.id === 'run-legacy');
    const ids = (s) => ({ linked: s.linked.map((r) => r.id).sort(), facility: s.facility.map((r) => r.id).sort(), unsigned: s.unsignedMatching });
    return {
      full: ids(window.glAtpSelectForClient(RECORDS, ACME, acmeRuns, { includeFacility: true, signedOnly: true })),
      noFac: ids(window.glAtpSelectForClient(RECORDS, ACME, acmeRuns, { includeFacility: false, signedOnly: true })),
      poisoned: ids(window.glAtpSelectForClient(RECORDS, ACME, RUNS, { includeFacility: true, signedOnly: true })),
    };
  }, { RECORDS, RUNS, ACME });
  check("another client's run is never included, even on a shared day", sel.full.linked.indexOf('r-linked') < 0, JSON.stringify(sel.full));
  check("a record stamped with another client's client_id is excluded", sel.full.linked.indexOf('mismatch') < 0);
  check("this client's runs are included (incl. a name-only legacy run)", JSON.stringify(sel.full.linked) === '["a-legacy","a-linked"]', JSON.stringify(sel.full));
  check('facility tests only on this client\'s production days, and only when asked', JSON.stringify(sel.full.facility) === '["fac-proday"]' && sel.noFac.facility.length === 0, JSON.stringify(sel));
  check('signed-only leaves the draft out and counts it', sel.full.unsigned === 1);
  check("passing the rival's run in by mistake still does not leak it", sel.poisoned.linked.indexOf('r-linked') < 0);

  // ── tab ──
  await page.evaluate(async () => { await window.glRenderAtpTab(document.getElementById('comp-body')); });
  const tab = await page.evaluate(() => ({ text: document.getElementById('comp-body').innerText, xss: window.__xss === 1 || !!document.querySelector('#comp-body img') }));
  check('the tab offers log, limits and PDF report', /Log ATP tests/.test(tab.text) && /ATP limits \(3\)/.test(tab.text) && /Customer PDF report/.test(tab.text), tab.text.slice(0, 300));
  check('script in stored equipment/location/CA does not run in the tab', !tab.xss);

  // ── PDF report ──
  await page.evaluate(() => window.glOpenAtpReport());
  await page.waitForSelector('#gl-cf-atpr-client');
  await page.fill('#gl-cf-atpr-from', '2026-10-01');
  await page.fill('#gl-cf-atpr-to', '2026-10-31');
  await page.selectOption('#gl-cf-atpr-client', ACME);
  await page.waitForFunction(() => /testing session/.test(document.getElementById('atpr-preview').innerText), null, { timeout: 5000 });
  const prev = await page.evaluate(() => document.getElementById('atpr-preview').innerText);
  check('the builder previews the content and flags the unsigned record', /3 testing sessions/.test(prev) && /1 matching record is not PCQI-signed/.test(prev), prev);
  await page.click('#atpr-go');
  await page.waitForFunction(() => !!window.__savedPdf, null, { timeout: 10000 });
  const pdf = await page.evaluate(() => ({ name: window.__savedName, raw: window.__savedPdf }));
  check('a PDF file downloads with the client and period in its name', pdf.name === 'ATP-Report_Acme-Soda-Co_2026-10-01_to_2026-10-31.pdf' && /^%PDF-/.test(pdf.raw), pdf.name);
  check('the PDF is addressed to the client and lists their runs and tests',
    /Acme Soda Co/.test(pdf.raw) && /Acme Lime Seltzer/.test(pdf.raw) && /Lot L-A1/.test(pdf.raw) && /Filler bowl/.test(pdf.raw) && /Legacy surface/.test(pdf.raw) && /Tank interior wall/.test(pdf.raw));
  check("the other client's name appears nowhere in the PDF", !/RivalCo/i.test(pdf.raw), (pdf.raw.match(/.{40}RivalCo.{40}/i) || [''])[0]);
  check("the other client's tests and off-day tests are not in the PDF", !/RivalCo-only valve|Mismatched record|Other-day test|Unsigned point/.test(pdf.raw));
  check('limits applied, test-type descriptions and the ATP disclaimer are stated',
    /Pass <= 10 RLU/.test(pdf.raw) && /UltraSnap: Standard surface ATP test/.test(pdf.raw) && /specific pathogens/.test(pdf.raw) && /absence of allergens/.test(pdf.raw));
  check('operator notes are left out by default', !/Ran right after/.test(pdf.raw));
  const aud = await page.evaluate(() => (window.__audit || []).find((a) => a[0] === 'atp_report_generated'));
  check('generating a report is audited', !!aud && aud[1] === ACME, JSON.stringify(aud));
  await page.evaluate(() => { window.__savedPdf = null; });
  await page.check('#atpr-notes');
  await page.click('#atpr-go');
  await page.waitForFunction(() => !!window.__savedPdf, null, { timeout: 10000 });
  const pdf2 = await page.evaluate(() => window.__savedPdf);
  check('operator notes appear only when asked for', /Ran right after/.test(pdf2));
  if (process.env.ATP_PDF_OUT) fs.writeFileSync(process.env.ATP_PDF_OUT, Buffer.from(pdf.raw, 'binary'));

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
