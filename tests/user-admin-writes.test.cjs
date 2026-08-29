/*
 * user-admin-writes.test.cjs — role change and deactivation must not report
 * success when the database did not change.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two bugs, one symptom.
 *
 * 1. index.html carried a legacy saveRole/deactivateUser pair that called
 *    renderPermissionsPanel() *before* the update and *outside* the try. That
 *    function is declared inside the src/services/permissions-service.js IIFE and never
 *    exported, so the bare call threw a ReferenceError and the UPDATE below it
 *    never ran. Role changes and deactivations did nothing at all — a
 *    deactivated staff member could still sign in — and the click looked like
 *    a dead button.
 *
 * 2. Even had it run, the update had no .select() and no rows-affected check.
 *    RLS rejects silently — 0 rows, no error — so a rejected write reports
 *    success. CLAUDE.md attributes ~40 bugs to this pattern.
 *
 * index.html now delegates to glChangeUserRole / glToggleUserActive, which do
 * it correctly. This file guards both halves: that the correct implementations
 * really do refuse a 0-row result, and that index.html does not grow a second
 * unchecked copy again.
 *
 * Run:  NODE_PATH=<playwright>/node_modules node tests/user-admin-writes.test.cjs
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PERMISSIONS_JS = path.join(ROOT, 'src/services/permissions-service.js');
const INDEX_HTML = path.join(ROOT, 'index.html');

const TARGET_USER = '11111111-1111-1111-1111-111111111111';

/*
 * Harness loads src/services/permissions-service.js with the globals it reaches for, plus a
 * fake Supabase whose response is chosen per-test. Captured alerts and
 * notifications are how we observe whether a failure was surfaced.
 */
const HARNESS = (src) => `<!doctype html>
<html><body>
  <div id="users-list"></div>
  <script>
    window.__alerts = [];
    window.__notes  = [];
    window.__audits = [];
    window.alert   = function(m){ window.__alerts.push(String(m)); };
    window.confirm = function(){ return true; };          // always approve
    window.addNotification = function(t, b, k){ window.__notes.push({t:t, b:b, k:k}); };
    window.glAudit = function(a){ window.__audits.push(a); };
    window.glEsc = function(s){ return String(s == null ? '' : s); };
    window.GL_HOOKS = { registerNavGuard(){}, registerLoginHook(){}, registerLogoutHook(){}, registerRenderHook(){} };
    window.currentUser = { id: 'admin-uuid', role: 'admin', email: 'admin@test.local' };
    window.PERMISSIONS = {};
    window.users = [];

    // __mode drives what the fake database returns for the write.
    window.__mode = 'ok';
    function writeResult(){
      if (window.__mode === 'error')  return { data: null, error: { message: 'permission denied' } };
      if (window.__mode === 'norows') return { data: [], error: null };   // silent RLS rejection
      return { data: [{ id: ${JSON.stringify(TARGET_USER)} }], error: null };
    }
    // PostgREST builders are chainable AND thenable, and the two code paths
    // under test terminate differently:
    //   write:  update(...).eq(...).select()          -> awaited
    //   read:   select(...).eq(...).maybeSingle()     -> awaited
    // so select() must return the builder, not a promise. Returning a promise
    // here made .eq() run on a Promise and glToggleUserActive bail out before
    // its first alert — which is what the first CI run of this file caught.
    window.supa = {
      from(){
        const q = {
          update(){ return q; },
          eq(){ return q; },
          select(){ return q; },
          maybeSingle(){ return Promise.resolve({ data: { id: ${JSON.stringify(TARGET_USER)}, email:'target@test.local', name:'Target', status:'active' }, error: null }); },
          then(res, rej){ return Promise.resolve(writeResult()).then(res, rej); }
        };
        return q;
      }
    };
  <\/script>
  <script>${src}<\/script>
</body></html>`;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

async function run(page, src, mode, fn) {
  await page.setContent(HARNESS(src));
  return page.evaluate(async ([m, which, uid]) => {
    window.__mode = m;
    window.__alerts = []; window.__notes = []; window.__audits = [];
    try {
      if (which === 'role') await window.glChangeUserRole(uid, 'warehouse');
      else                  await window.glToggleUserActive(uid);
    } catch (e) {
      window.__threw = String(e);
    }
    return { alerts: window.__alerts, notes: window.__notes, audits: window.__audits, threw: window.__threw || null };
  }, [mode, fn, TARGET_USER]);
}

(async () => {
  const src = fs.readFileSync(PERMISSIONS_JS, 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  console.log('role change / deactivation — a rejected write must not report success\n');

  // ── glChangeUserRole ──────────────────────────────────────────────────
  let r = await run(page, src, 'norows', 'role');
  check('role: 0 rows returned -> the user is told it did NOT apply',
    r.alerts.some(a => /0 rows|has NOT been/i.test(a)),
    'alerts: ' + JSON.stringify(r.alerts));
  check('role: 0 rows returned -> no success notification',
    !r.notes.some(n => n.k === 'success'),
    'notes: ' + JSON.stringify(r.notes));

  r = await run(page, src, 'error', 'role');
  check('role: database error -> surfaced to the user',
    r.alerts.some(a => /failed|permission denied/i.test(a)),
    'alerts: ' + JSON.stringify(r.alerts));
  check('role: database error -> no success notification',
    !r.notes.some(n => n.k === 'success'));

  r = await run(page, src, 'ok', 'role');
  check('role: success -> confirmed to the user',
    r.notes.some(n => n.k === 'success'),
    'notes: ' + JSON.stringify(r.notes));
  check('role: success -> no failure alert', r.alerts.length === 0,
    'alerts: ' + JSON.stringify(r.alerts));

  // ── glToggleUserActive ────────────────────────────────────────────────
  console.log('');
  r = await run(page, src, 'norows', 'active');
  check('status: 0 rows returned -> the user is told it did NOT apply',
    r.alerts.some(a => /0 rows|has NOT been/i.test(a)),
    'alerts: ' + JSON.stringify(r.alerts));
  check('status: 0 rows returned -> nothing written to the audit log',
    r.audits.length === 0,
    'audits: ' + JSON.stringify(r.audits));

  r = await run(page, src, 'error', 'active');
  check('status: database error -> surfaced to the user',
    r.alerts.some(a => /failed|permission denied/i.test(a)));
  check('status: database error -> nothing written to the audit log', r.audits.length === 0);

  r = await run(page, src, 'ok', 'active');
  check('status: success -> confirmed to the user', r.notes.length > 0);
  check('status: success -> audit entry written', r.audits.length > 0);

  await browser.close();

  // ── index.html must not reintroduce the unchecked pair ────────────────
  // A source check, not a behavioural one: the defect was a call that threw
  // before the write, so the guard is that the call is gone and the handlers
  // delegate.
  console.log('');
  // The core script moved out of index.html into crm-index-core.js (GL-037).
  // indexCore() is index.html plus whatever the inline block was extracted
  // into, so these assertions keep meaning the same thing as that continues.
  const html = require('./_sources.cjs').indexCore();
  const bareRender = /^\s*renderPermissionsPanel\(\)/m.test(html);
  check('index.html: no bare renderPermissionsPanel() call (it is IIFE-local and throws)', !bareRender);
  check('index.html: saveRole delegates to glChangeUserRole',
    /saveRole[\s\S]{0,600}?window\.glChangeUserRole/.test(html));
  check('index.html: deactivateUser delegates to glToggleUserActive',
    /deactivateUser[\s\S]{0,600}?window\.glToggleUserActive/.test(html));
  check('index.html: no unchecked profiles update left in these handlers',
    !/update\(\{role:[^)]*\}\)\.eq\('id',changeRoleUserId\)(?!\.select)/.test(html));

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
