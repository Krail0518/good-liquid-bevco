/*
 * project-tracker.test.cjs — the staff Project Tracker builds the right line
 * and never lets client-typed text reach the page unescaped.
 *
 * Loads the real src/modules/pipeline/project-tracker.js in a vm with a stub
 * window/document (no browser), feeds build() fixture rows shaped like the
 * Supabase responses, and renders into a stub #trk-body.
 *
 * Run:  node tests/project-tracker.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const els = {};
function el(id) { return els[id] || (els[id] = { id, innerHTML: '', textContent: '', addEventListener() {}, classList: { contains: () => false } }); }
const window = {};
window.window = window;
const document = {
  readyState: 'loading',            // keeps watch() from polling for the page
  addEventListener() {},
  getElementById: (id) => (id === 'trk-body' || id === 'trk-sub' ? el(id) : null),
  querySelector: () => null
};
const ctx = vm.createContext({ window, document, console, setTimeout, Date, Promise, MutationObserver: function () { this.observe = () => {}; } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/modules/pipeline/project-tracker.js'), 'utf8'), ctx);
const T = window.__glTrackerInternals;
check('module exposes its pure internals', T && typeof T.build === 'function');
check('there are exactly 14 visible steps', T.STEPS.length === 14, 'got ' + T.STEPS.length);

const XSS = '<img src=x onerror=alert(1)>';
const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
function ms(project, key, sort, status, round, extra) {
  return Object.assign({ id: project + ':' + key + ':' + (round || 1), project_id: project, track: 'formulation', key,
    label: key, sort_order: sort, round: round || 1, status, owner: 'gl', completed_at: status === 'completed' ? iso(30) : null,
    updated_at: iso(3) }, extra || {});
}
const P = 'p1';
const fixture = {
  clients: [{ id: 'c1', name: 'Contact', company: XSS, email: 'a@b.co' }, { id: 'c2', name: 'Won Co', company: 'Won Co', email: 'won@x.co' }],
  projects: [{ id: P, client_id: 'c1', name: 'Ginger', product_name: '"><script>x</script>', status: 'active' }],
  milestones: [
    ms(P, 'intake', 1, 'completed'), ms(P, 'formulation', 2, 'completed'),
    ms(P, 'batch_1l_sent', 3, 'completed'), ms(P, 'client_feedback', 4, 'completed'), ms(P, 'formula_revisions', 5, 'completed'),
    ms(P, 'batch_1l_sent', 3, 'completed', 2), ms(P, 'client_feedback', 4, 'awaiting_client', 2, { updated_at: iso(20) }),
    ms(P, 'formula_revisions', 5, 'not_started', 2),
    ms(P, 'batch_1l_approved', 6, 'not_started'), ms(P, 'batch_50l', 7, 'not_started'), ms(P, 'pa_letter', 8, 'not_started'),
    ms(P, 'production_scheduled', 9, 'not_started'), ms(P, 'production_run', 10, 'not_started'),
    ms(P, 'shipped', 11, 'not_started'), ms(P, 'invoiced_paid', 12, 'not_started'),
    { id: 'art', project_id: P, track: 'artwork', key: 'packaging_artwork', label: 'Packaging', sort_order: 1, round: 1, status: 'in_progress', owner: 'gl', updated_at: iso(1) }
  ],
  deals: [
    // converted lead for c1 — must NOT produce a second row (matched by email)
    { id: 'd1', co: 'Different name', email: 'A@B.co', stage: 'Closed Won', created_at: iso(60), updated_at: iso(60) },
    { id: 'd2', co: XSS, email: 'new@x.co', stage: 'Proposal', stage_entered_at: iso(4), created_at: iso(10), updated_at: iso(4) },
    { id: 'd3', co: 'Old lead', stage: 'Prospecting', created_at: iso(400), updated_at: iso(300) },
    { id: 'd4', co: 'Won Co', email: 'won@x.co', stage: 'Closed Won', stage_entered_at: iso(2), created_at: iso(30), updated_at: iso(2) }
  ],
  quotes: [{ id: 'q1', deal_id: 'd2', status: 'sent', sent_at: iso(4) }],
  intake: [],
  onboarding: []
};

const rows = T.build(fixture);
const proj = rows.find((r) => r.id === 'p:' + P);
check('a project row is built', !!proj);
check('a converted lead is not shown twice', !rows.find((r) => r.id === 'd:d1'));
check('project row: all four sales steps done', proj && proj.steps.slice(0, 4).every((s) => s.v === 'done'));
check('project row: current step is the 1 L loop, waiting on client',
  proj && proj.current && proj.current.def.key === 'loop_1l' && proj.current.v === 'wait',
  proj && proj.current && proj.current.def.key + '/' + proj.current.v);
check('project row: the loop reports round 2', proj && proj.current.loop.round === 2);
check('project row: 20 days on step is stalled', proj && proj.stalled === true && proj.daysOnStep === 20, proj && proj.daysOnStep);
check('project row: next step is 1 L batch approved', proj && proj.next && proj.next.def.key === 'batch_1l_approved');

const lead = rows.find((r) => r.id === 'd:d2');
check('lead row exists', !!lead);
check('lead row: Lead in, Qualified and Quote sent done; Won current',
  lead && ['done', 'done', 'done', 'cur'].join() === lead.steps.slice(0, 4).map((s) => s.v).join(),
  lead && lead.steps.slice(0, 4).map((s) => s.v).join());
check('lead row: phase is sales', lead && lead.phase === 'sales');
const old = rows.find((r) => r.id === 'd:d3');
check('a Prospecting lead untouched for 300 days is marked old', old && old.oldLead === true);
const won = rows.find((r) => r.id === 'd:d4');
check('a won deal with a client but no project offers Create project', won && won.won && won.clientId === 'c2');
check('won deal: onboarding is the current step', won && won.current && won.current.def.key === 'intake');

// Approval closes the loop: the dot is done and the 50 L batch is next.
const approved = JSON.parse(JSON.stringify(fixture));
approved.milestones.forEach((m) => {
  if (m.key === 'client_feedback' && m.round === 2) m.status = 'completed';
  if (m.key === 'formula_revisions' && m.round === 2) m.status = 'skipped';
  if (m.key === 'batch_1l_approved') m.status = 'completed';
  if (m.key === 'batch_50l') m.status = 'in_progress';
});
const p2 = T.build(approved).find((r) => r.id === 'p:' + P);
check('after approval the 1 L dot is done', p2.steps[6].v === 'done', p2.steps[6].v);
check('after approval the current step is the 50 L batch', p2.current.def.key === 'batch_50l', p2.current.def.key);

// Render: everything typed by a lead or client is escaped.
window.supa = {};
// render() is internal; drive it through refresh() with a stub client.
function q(data) {
  const chain = { select: () => chain, is: () => chain, in: () => chain, neq: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    then: (res) => res({ data, error: null }) };
  return chain;
}
window.supa.from = (t) => q({ projects: fixture.projects, project_milestones: fixture.milestones, clients: fixture.clients, deals: fixture.deals,
  quotes: fixture.quotes, product_intake: fixture.intake, onboarding: fixture.onboarding }[t] || []);
(async () => {
  await window.glRefreshProjectTracker();
  const html = el('trk-body').innerHTML;
  check('render produced rows', html.indexOf('gl-trk-row') > -1, html.slice(0, 200));
  check('a brand name with markup is escaped', html.indexOf(XSS) === -1 && html.indexOf('&lt;img src=x onerror=alert(1)&gt;') > -1);
  check('a product name with markup is escaped', html.indexOf('<script>x</script>') === -1);
  check('no inline event handler attributes are emitted', !/\son[a-z]+=\s*["']/i.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')));
  check('the old lead is hidden by default', html.indexOf('Old lead') === -1);
  check('the subtitle counts projects and leads', /1 projects · 2 open leads/.test(el('trk-sub').textContent), el('trk-sub').textContent);

  console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
