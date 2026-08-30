/*
 * auth-fail-closed.test.cjs — a failed or empty profile lookup must deny the
 * login, not invent one.
 *
 * WHY THIS EXISTS
 * ---------------
 * checkPw() used to do this when the profiles lookup came back empty:
 *
 *     profile = { role:'sales', status:'active', ... }   // fabricated
 *
 * _glFetchProfile returns nothing in three different situations — the row is
 * missing, the query errored, or it threw — and all three landed here. Supabase
 * signup is open, so a self-registered stranger with no profiles row was handed
 * an active salesperson identity and shown the CRM shell; a transient 500 did
 * the same for whoever happened to be signing in at the time.
 *
 * The database was never fooled. RLS refuses those queries, which is exactly
 * why the production invariant probe kept passing and nothing looked wrong. But
 * that is a second line of defence being asked to do the first line's job, and
 * it contradicts 20260828175051_staff_profile_requires_invite.sql, which made
 * staff identity fail closed in the database on the same premise.
 *
 * Found by an external audit (its GL-002) of a 284-commit-old snapshot. Most of
 * that document described code that no longer exists; this part was current.
 *
 * WHAT IS ASSERTED
 * ----------------
 * The four denial paths and the one success path, driven through the real
 * checkPw against a fake Supabase client. A denial must ALSO sign out — a
 * refused login that leaves a live session behind is still a session.
 *
 * Run:  NODE_PATH=<playwright>/node_modules node tests/auth-fail-closed.test.cjs
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const AUTH_JS = fs.readFileSync(path.join(ROOT, 'src/services/auth.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

/* One scenario = one profiles-lookup outcome. */
async function run(page, scenario) {
  return page.evaluate(async ([src, sc]) => {
    // ── fakes ────────────────────────────────────────────────────────────
    const state = { loggedIn: null, signedOut: false, err: '' };

    document.body.innerHTML =
      '<div id="pw-ov"><input id="pw-email" value="someone@example.com">' +
      '<input id="pw-input" type="password" value="pw"><div id="pw-err"></div></div>';

    const client = {
      auth: {
        signInWithPassword: async () => ({ data: { user: { id: 'u1', email: 'someone@example.com' } }, error: null }),
        signOut: async () => { state.signedOut = true; },
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => {
            if (sc.mode === 'error')   return { data: null, error: { message: 'boom' } };
            if (sc.mode === 'throw')   throw new Error('network');
            if (sc.mode === 'missing') return { data: null, error: null };
            return { data: sc.row, error: null };
          },
        };
      },
    };

    window.supa = client;
    window.getSupa = () => client;
    window.users = [];
    window.loginUser = (u) => { state.loggedIn = u; };
    window.closePw = () => {};
    window.customerLogins = [];

    // Load the real module.
    const s = document.createElement('script');
    s.textContent = src;
    document.head.appendChild(s);

    if (typeof window.checkPw !== 'function') return { error: 'checkPw not defined' };
    await window.checkPw();
    await new Promise((r) => setTimeout(r, 60));

    const errEl = document.getElementById('pw-err');
    return {
      loggedIn: state.loggedIn ? { role: state.loggedIn.role, status: state.loggedIn.status } : null,
      signedOut: state.signedOut,
      message: errEl ? (errEl.textContent || '') : '',
    };
  }, [AUTH_JS, scenario]);
}

(async () => {
  console.log('auth fails closed — a missing or failed profile must not become staff\n');

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('about:blank');

  const active = { id: 'u1', email: 'someone@example.com', role: 'sales', status: 'active', name: 'Someone' };

  const cases = [
    ['no profiles row at all (a self-registered stranger)', { mode: 'missing' }],
    ['the profile query errors',                            { mode: 'error' }],
    ['the profile query throws',                            { mode: 'throw' }],
    ['the row exists but is inactive',                      { mode: 'row', row: Object.assign({}, active, { status: 'inactive' }) }],
    ['the row exists but carries no role',                  { mode: 'row', row: Object.assign({}, active, { role: null }) }],
    ['the row carries a PORTAL role, not a staff one',      { mode: 'row', row: Object.assign({}, active, { role: 'owner' }) }],
  ];

  for (const [label, sc] of cases) {
    const r = await run(page, sc);
    if (r.error) { check(label, false, r.error); continue; }
    check('denied: ' + label, r.loggedIn === null,
      'logged in as role=' + (r.loggedIn && r.loggedIn.role) + ' status=' + (r.loggedIn && r.loggedIn.status) +
      ' — this is the fabricated-identity bug');
    // A refusal that leaves the Supabase session alive is not a refusal.
    check('  ...and the session is signed out', r.signedOut === true,
      'the login was refused but the auth session was left live');
    check('  ...and the user is told why', (r.message || '').length > 0);
  }

  // The control case: a real active staff profile must still get in, or this
  // guard would be indistinguishable from breaking login.
  const ok = await run(page, { mode: 'row', row: active });
  check('an active staff profile still logs in', ok.loggedIn !== null && ok.loggedIn.role === 'sales',
    'the fix locked out a legitimate user');
  check('  ...and is not signed out', ok.signedOut === false);

  await browser.close();
  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
