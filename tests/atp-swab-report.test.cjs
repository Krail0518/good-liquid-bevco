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
 *   - every test the EnSURE reads is offered, grouped ATP / MicroSnap / enzyme
 *   - MicroSnap records incubation; units follow the limit rule (RLU, CFU, mU/L)
 *   - signing from Open Logs enforces the same rules, judging old drafts
 *     against the current limits
 *   - a daily pre-op ATP task is generated on production days
 *   - ONE JOB = ONE RECORD: a test plan fills the job's rows, a draft keeps
 *     blank readings, re-opening the job continues the same record, signing
 *     updates it in place, and the job downloads as one PDF
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
  rec('a-legacy', 'run-legacy', '2026-10-20', 'signed', [T('Filler 1', 'Legacy surface', 9, 'pass'),
    T('Filler 1', 'Filler valves', 4, 'pass', { test_type: 'microsnap_eb', test_name: 'MicroSnap EB', category: 'micro', unit: 'CFU',
      limits: { pass_max: 10, fail_above: 100, unit: 'CFU', basis: 'MicroSnap EB · any equipment · any location' },
      incubation: { started_at: '2026-10-20T06:00:00Z', temp_c: 37, hours: 6 } })]),
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
  return r.id === 'run-a1' ? Object.assign({}, r, { scheduled_start_date: new Date().toISOString().slice(0,10), scheduled_date: new Date().toISOString().slice(0,10) }) : r;
});
window.addNotification = function(){};
window.glAudit = function(a, t, d){ (window.__audit = window.__audit || []).push([a, t, d]); };
var DB = { production_runs: ${JSON.stringify(RUNS)}, compliance_records: ${JSON.stringify(RECORDS)}, clients: ${JSON.stringify(CLIENTS)},
  compliance_tasks: [], hold_tags: [], cip_equipment: [{ name:'Filler 1', active:true, sort_order:10 }, { name:'Brite Tank 3', active:true, sort_order:20 }] };
window.__inserts = [];
function Q(t){ this.t = t; this.f = []; this.op = 'select'; this.row = null; this.one = false; }
['select','limit'].forEach(function(m){ Q.prototype[m] = function(){ return this; }; });
Q.prototype.order = function(k, o){ (this.ord = this.ord || []).push([k, !(o && o.ascending === false)]); return this; };
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
    if(self.ord){ rows = rows.slice().sort(function(a, b){
      for(var i = 0; i < self.ord.length; i++){
        var k = self.ord[i][0], asc = self.ord[i][1], x = a[k], y = b[k];
        if(typeof x !== 'number' || typeof y !== 'number'){ x = String(x == null ? '' : x); y = String(y == null ? '' : y); }
        if(x < y) return asc ? -1 : 1; if(x > y) return asc ? 1 : -1;
      }
      return 0; }); }
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
  check('every EnSURE test type is offered', JSON.stringify(lim.types) === '["UltraSnap","SuperSnap","AquaSnap Total","AquaSnap Free","MicroSnap Total","MicroSnap EB","MicroSnap Coliform","MicroSnap E. coli","ZymoSnap ALP","CrossCheck"]', JSON.stringify(lim.types));
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
  check('limits saved org-wide as 3 rules, each with its unit', saved && saved.rules.length === 3 && saved.rules.every((r) => r.unit === 'RLU') && saved.rules[1].equipment === 'Filler 1' && saved.rules[1].location === 'Filler nozzles', JSON.stringify(saved));

  // ── log form with limits ──
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-atp-tests .gl-atp-row');
  const typeOpts = await page.$$eval('.gl-atp-type option', (o) => o.map((x) => x.textContent));
  const groups = await page.$$eval('.gl-atp-type optgroup', (o) => o.map((x) => x.label));
  check('the test-type dropdown lists every EnSURE test', JSON.stringify(typeOpts) === '["UltraSnap","SuperSnap","AquaSnap Total","AquaSnap Free","MicroSnap Total","MicroSnap EB","MicroSnap Coliform","MicroSnap E. coli","ZymoSnap ALP","CrossCheck"]', JSON.stringify(typeOpts));
  check('test types are grouped ATP / MicroSnap / enzyme', groups.length === 3 && /ATP/.test(groups[0]) && /MicroSnap/.test(groups[1]) && /Enzyme/.test(groups[2]), JSON.stringify(groups));
  const inst = await page.evaluate(() => [document.getElementById('gl-cf-atp-lum').value, document.getElementById('gl-cf-atp-serial').value]);
  check("the instrument defaults to the facility's EnSURE V.2 #091688", inst[0] === 'EnSURE V.2' && inst[1] === '091688', JSON.stringify(inst));
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
  check('session records operator, luminometer and date/time', sv.data.operator === 'Sam Staff' && sv.data.luminometer === 'EnSURE V.2' && sv.data.luminometer_serial === '091688' && !!sv.data.tested_at, JSON.stringify(sv.data).slice(0, 300));
  check('test 1: equipment, location, type, RLU, limits, result, CA, retest',
    t0.equipment === 'Filler 1' && t0.location === 'Filler nozzles' && t0.test_type === 'ultrasnap' && t0.rlu === 12 &&
    t0.limits.pass_max === 3 && t0.limits.fail_above === 10 && t0.result === 'fail' && t0.corrective_action === 'Re-cleaned nozzles' &&
    t0.retest_rlu === 2 && t0.retest_result === 'pass' && t0.final_result === 'pass', JSON.stringify(t0));
  check('test 2: AquaSnap Total judged against its own location limit', t1.test_type === 'aquasnap_total' && t1.limits.pass_max === 50 && t1.result === 'fail', JSON.stringify(t1));
  check('the unresolved FAIL is a deviation; the corrected one is not', sv.has_deviation === true && /Brite Tank 3 \/ CIP final rinse 140 RLU/.test(sv.deviation_notes) && !/Filler nozzles/.test(sv.deviation_notes), sv.deviation_notes);

  // ── MicroSnap incubation + units ──
  await page.evaluate(() => { window.GL_APP_SETTINGS.atp_limits.rules.push(
    { test_type: 'microsnap_eb', equipment: null, location: null, unit: 'CFU', pass_max: 10, fail_above: 100 },
    { test_type: 'zymosnap_alp', equipment: null, location: null, unit: 'mU/L', pass_max: 100, fail_above: 350 }); });
  const badUnit = await page.evaluate(() => window.glAtpValidateRules([{ test_type: 'ultrasnap', unit: 'CFU', pass_max: 1, fail_above: 2 }]));
  check('a unit the test cannot read in is refused', badUnit.length === 1 && /not read in CFU/.test(badUnit[0]), JSON.stringify(badUnit));
  await page.evaluate(() => window.glOpenAtpLimits());
  await page.waitForSelector('.gl-atpl-row');
  const zrow = (await page.$$('.gl-atpl-row'))[4];
  const zinfo = await zrow.evaluate((r) => ({ units: [...r.querySelectorAll('.gl-atpl-unit option')].map((o) => o.value), unit: r.querySelector('.gl-atpl-unit').value, hint: r.querySelector('.gl-atpl-hint').textContent }));
  check('ZymoSnap rule offers mU/L and shows the Hygiena reference as a hint', JSON.stringify(zinfo.units) === '["mU/L","RLU"]' && zinfo.unit === 'mU/L' && /350 mU\/L/.test(zinfo.hint), JSON.stringify(zinfo));
  await page.click('.gl-cf-cancel');
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-atp-tests .gl-atp-row');
  const mrow = (await page.$$('#gl-atp-tests .gl-atp-row'))[0];
  const incHidden = await mrow.$eval('.gl-atp-inc', (e) => getComputedStyle(e).display === 'none');
  await (await mrow.$('.gl-atp-type')).selectOption('microsnap_eb');
  const incShown = await mrow.$eval('.gl-atp-inc', (e) => getComputedStyle(e).display !== 'none');
  check('incubation fields appear only for MicroSnap', incHidden && incShown);
  await (await mrow.$('.gl-atp-equip')).selectOption('Filler 1');
  await (await mrow.$('.gl-atp-loc')).fill('Filler valves');
  await (await mrow.$('.gl-atp-rlu')).fill('4');
  const mres = await mrow.$eval('.gl-atp-res', (e) => e.innerText);
  const munit = await mrow.$eval('.gl-atp-unit', (e) => e.textContent);
  check('MicroSnap EB judged in CFU against its own rule', /Fail > 100 CFU/.test(mres) && /PASS/.test(mres) && munit === '(CFU)', mres + ' ' + munit);
  const disc = await page.$eval('#gl-atp-disclaim', (e) => e.textContent);
  check('the form shows the indicator-organism statement for MicroSnap', /Salmonella, Listeria/.test(disc) && !/adenosine/.test(disc), disc);
  await page.click('.gl-cf-sign');
  const merr = await page.$eval('#gl-atp-err', (e) => e.innerText);
  check('MicroSnap cannot be signed without incubation start, temperature and hours', /incubation start, temperature and hours/.test(merr), merr);
  await (await mrow.$('.gl-atp-incstart')).fill('2026-11-12T06:00');
  await (await mrow.$('.gl-atp-inctemp')).fill('37');
  await (await mrow.$('.gl-atp-inchrs')).fill('6');
  const nBefore = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_records').length);
  await page.click('.gl-cf-sign');
  await page.waitForFunction((n) => window.__inserts.filter((i) => i[0] === 'compliance_records').length > n, nBefore, { timeout: 5000 });
  const ms = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_records').pop()[1].data.tests[0]);
  check('MicroSnap saved with category, unit and incubation', ms.category === 'micro' && ms.unit === 'CFU' && ms.incubation.temp_c === 37 && ms.incubation.hours === 6 && !!ms.incubation.started_at, JSON.stringify(ms));

  // ── signing a draft from Open Logs ──
  const prep = await page.evaluate(() => {
    const draft = { form_code: 'GMP-ATP-001', status: 'draft', data: { tests: [
      { test_type: 'ultrasnap', equipment: 'Filler 1', location: 'Filler nozzles', rlu: 12, limits: null, result: null, retest_rlu: null, final_result: null, corrective_action: null }] } };
    const ok = window.glAtpPrepareSign(draft);
    const noLim = window.glAtpPrepareSign({ data: { tests: [{ test_type: 'supersnap', equipment: 'Filler 1', location: 'X', rlu: 1, limits: null }] } });
    const micro = window.glAtpPrepareSign({ data: { tests: [{ test_type: 'microsnap_eb', equipment: 'Filler 1', location: 'X', rlu: 1, limits: { pass_max: 10, fail_above: 100, unit: 'CFU' }, result: 'pass', final_result: 'pass' }] } });
    return { ok, noLim, micro };
  });
  check('a draft saved before limits existed is judged on sign-off and says so',
    prep.ok.error && /FAIL needs a corrective action/.test(prep.ok.error), JSON.stringify(prep.ok));
  check('sign-off refuses a test with no limit', /no limit is set/.test(prep.noLim.error || ''), JSON.stringify(prep.noLim));
  check('sign-off refuses MicroSnap without incubation', /incubation/.test(prep.micro.error || ''), JSON.stringify(prep.micro));
  const prep2 = await page.evaluate(() => window.glAtpPrepareSign({ form_code: 'GMP-ATP-001', data: { tests: [
    { test_type: 'ultrasnap', equipment: 'Filler 1', location: 'Filler nozzles', rlu: 12, limits: null, retest_rlu: 2, corrective_action: 'Re-cleaned' }] } }));
  const pt = prep2.patch && prep2.patch.data.tests[0];
  check('sign-off applies the current limit (3/10) and records that it did', pt && pt.limits.pass_max === 3 && pt.result === 'fail' && pt.final_result === 'pass' && pt.limits_applied_at_sign === true && prep2.patch.has_deviation === false, JSON.stringify(prep2));

  // Through the real Open Logs button.
  await page.evaluate(() => { const m = document.getElementById('gl-comp-modal'); if (m) m.remove(); DB.compliance_records.push(
    { id: 'nolimit-draft', form_code: 'GMP-ATP-001', status: 'draft', record_date: '2026-11-12', recorded_at: '2026-11-12T10:00:00Z',
      data: { tests: [{ test_type: 'supersnap', equipment: 'Filler 1', location: 'Bowl', rlu: 3, limits: null }] } }); });
  const dialogs = [];
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.evaluate(() => window.refreshComplianceMaster());
  await page.waitForSelector('.gl-comp-tab[data-tab="open"]');
  const tasks = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_tasks').map((i) => i[1].task_type));
  check('a daily pre-op ATP task is generated on a production day', tasks.indexOf('atp_swab') >= 0, JSON.stringify(tasks));
  await page.click('.gl-comp-tab[data-tab="open"]');
  await page.waitForSelector('.gl-comp-sign[data-id="nolimit-draft"]');
  await page.click('.gl-comp-sign[data-id="nolimit-draft"]');
  await page.waitForTimeout(300);
  const nl2 = await page.evaluate(() => DB.compliance_records.find((r) => r.id === 'nolimit-draft').status);
  check('Open Logs refuses to sign an ATP draft that breaks the rules', nl2 === 'draft' && dialogs.some((m) => /cannot be signed yet/.test(m)), JSON.stringify(dialogs));
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Seamer 2') : d.accept());

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
  check('the tab offers log, limits and PDF report', /Log ATP tests/.test(tab.text) && /ATP limits \(5\)/.test(tab.text) && /Customer PDF report/.test(tab.text), tab.text.slice(0, 300));
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
  check('a report with MicroSnap results is titled and qualified accordingly',
    /Hygiene Monitoring Report/.test(pdf.raw) && /Inc\. 6 h @ 37/.test(pdf.raw) && /Pass <= 10 CFU/.test(pdf.raw) && /Salmonella, Listeria/.test(pdf.raw));
  const aud = await page.evaluate(() => (window.__audit || []).find((a) => a[0] === 'atp_report_generated'));
  check('generating a report is audited', !!aud && aud[1] === ACME, JSON.stringify(aud));
  await page.evaluate(() => { window.__savedPdf = null; });
  await page.check('#atpr-notes');
  await page.click('#atpr-go');
  await page.waitForFunction(() => !!window.__savedPdf, null, { timeout: 10000 });
  const pdf2 = await page.evaluate(() => window.__savedPdf);
  check('operator notes appear only when asked for', /Ran right after/.test(pdf2));
  if (process.env.ATP_PDF_OUT) fs.writeFileSync(process.env.ATP_PDF_OUT, Buffer.from(pdf.raw, 'binary'));

  // ── One job = one record: test plan → draft with blank readings → continue → sign ──
  await page.evaluate(() => { const m = document.getElementById('gl-comp-modal'); if (m) m.remove(); });
  await page.evaluate(() => window.glOpenAtpPlans());
  await page.waitForSelector('#gl-atpp-new');
  await page.click('#gl-atpp-new');
  await page.fill('#gl-atpp-name', 'Acme job');
  await page.fill('#gl-atpp-client', 'Acme Soda Co');
  const PLAN = [['Filler 1', 'Tank interior'], ['Brite Tank 3', 'Tank interior'], ['Filler 1', 'Can interior'], ['Filler 1', 'Fill head 1'], ['Filler 1', 'Fill head 2']];
  for (let i = 0; i < PLAN.length; i++) {
    await page.click('#gl-atpp-edit button.cbtn');
    const r = (await page.$$('.gl-atpp-row'))[i];
    await (await r.$('.gl-atpp-eq')).selectOption(PLAN[i][0]);
    await (await r.$('.gl-atpp-loc')).fill(PLAN[i][1]);
  }
  await page.click('#gl-atpp-save');
  await page.waitForFunction(() => !document.getElementById('gl-comp-modal'), null, { timeout: 5000 });
  const plans = await page.evaluate(() => window.GL_APP_SETTINGS.atp_plans);
  check('a test plan is saved org-wide with its client and rows',
    plans && plans.plans.length === 1 && plans.plans[0].client_name === 'Acme Soda Co' && plans.plans[0].rows.length === 5 && plans.plans[0].rows[4].location === 'Fill head 2', JSON.stringify(plans));

  const nRec0 = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_records').length);
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-atp-tests .gl-atp-row');
  await page.selectOption('#gl-cf-atp-run', 'run-a1');
  await page.waitForFunction(() => document.querySelectorAll('#gl-atp-tests .gl-atp-row').length === 5, null, { timeout: 5000 });
  const locs = await page.$$eval('.gl-atp-loc', (e) => e.map((x) => x.value));
  check("picking the client's run loads its plan: all rows in one job", JSON.stringify(locs) === JSON.stringify(PLAN.map((p) => p[1])), JSON.stringify(locs));
  await page.click('.gl-cf-sign');
  const errBlank = await page.$eval('#gl-atp-err', (e) => e.innerText);
  check('a job with blank readings cannot be signed', /enter the reading before signing/.test(errBlank), errBlank);
  await page.click('.gl-cf-draft');
  await page.waitForFunction((n) => window.__inserts.filter((i) => i[0] === 'compliance_records').length > n, nRec0, { timeout: 5000 });
  const job = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_records').pop()[1]);
  check('the draft is ONE record holding all rows, readings pending',
    job.status === 'draft' && job.run_id === 'run-a1' && job.data.tests.length === 5 && job.data.tests.every((t) => t.rlu === null), JSON.stringify(job).slice(0, 300));
  const prepPending = await page.evaluate((j) => window.glAtpPrepareSign(j), job);
  check('Open Logs refuses to sign a job with readings still pending', /no reading entered yet/.test(prepPending.error || ''), JSON.stringify(prepPending));

  // Starting the same job again points at the existing record instead of making a second one.
  await page.evaluate(() => window.glOpenAtpSwabForm({}));
  await page.waitForSelector('#gl-cf-atp-run');
  await page.selectOption('#gl-cf-atp-run', 'run-a1');
  await page.waitForSelector('#gl-atp-cont', { timeout: 5000 });
  await page.click('#gl-atp-cont');
  await page.waitForFunction(() => /Continue job/.test((document.getElementById('gl-comp-modal') || {}).innerText || ''), null, { timeout: 5000 });
  const cont = await page.evaluate(() => ({ rows: document.querySelectorAll('#gl-atp-tests .gl-atp-row').length, locs: [...document.querySelectorAll('.gl-atp-loc')].map((x) => x.value) }));
  check('re-opening the job continues the same record with its rows', cont.rows === 5 && cont.locs[4] === 'Fill head 2', JSON.stringify(cont));
  await page.click('#gl-atp-add');
  const all = await page.$$('#gl-atp-tests .gl-atp-row');
  await (await all[5].$('.gl-atp-loc')).fill('Fill head 3');
  for (let i = 0; i < all.length; i++) await (await all[i].$('.gl-atp-rlu')).fill(String(i + 1));
  const nRec1 = await page.evaluate(() => window.__inserts.filter((i) => i[0] === 'compliance_records').length);
  await page.click('.gl-cf-sign');
  await page.waitForFunction(() => !document.getElementById('gl-comp-modal'), null, { timeout: 5000 });
  const after = await page.evaluate((id) => ({ rec: DB.compliance_records.find((r) => r.id === id), n: window.__inserts.filter((i) => i[0] === 'compliance_records').length }), job.id);
  check('signing the continued job updates the SAME record (no second report)', after.n === nRec1 && after.rec.status === 'signed' && after.rec.data.tests.length === 6, JSON.stringify({ n: after.n, nRec1, status: after.rec.status, tests: after.rec.data.tests.length }));
  check('readings and the added row are saved on that record',
    after.rec.data.tests[5].location === 'Fill head 3' && after.rec.data.tests.every((t, i) => t.rlu === i + 1) && after.rec.signature_name === 'Sam Staff', JSON.stringify(after.rec.data.tests.map((t) => [t.location, t.rlu])));
  const relock = await page.evaluate((r) => { const msgs = []; const a = window.alert; window.alert = (m) => msgs.push(m); window.glOpenAtpSwabForm({}, r); window.alert = a; return msgs; }, after.rec);
  check('a signed job cannot be reopened', relock.some((m) => /signed and locked/.test(m)), JSON.stringify(relock));

  // One PDF for the job, through the same isolation path.
  await page.evaluate(() => { window.__savedPdf = null; window.__savedName = null; });
  await page.evaluate((r) => window.glAtpDownloadJobPdf(r), after.rec);
  const jp = await page.evaluate(() => ({ name: window.__savedName, raw: window.__savedPdf }));
  check('a signed job downloads as ONE PDF named for the client and run', /^ATP-Job_Acme-Soda-Co_Acme-Lime-Seltzer_\d{4}-\d\d-\d\d\.pdf$/.test(jp.name || '') && /Fill head 3/.test(jp.raw || '') && !/RivalCo/.test(jp.raw || ''), jp.name);
  const leak = await page.evaluate(async (r) => { try { await window.glAtpDownloadJobPdf(r); return 'exported'; } catch (e) { return e.message; } },
    { id: 'mm', form_code: 'GMP-ATP-001', status: 'signed', run_id: 'run-a1', client_id: RIVAL, record_date: '2026-10-07', data: { tests: [] } });
  check("a job stamped with another client's id is refused, not exported", /does not belong/.test(leak), leak);

  check('no page errors', errors.length === 0, JSON.stringify(errors));
  await browser.close(); server.close();
  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
