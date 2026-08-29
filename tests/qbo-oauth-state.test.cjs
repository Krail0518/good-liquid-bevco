/*
 * qbo-oauth-state.test.cjs — the QuickBooks OAuth callback must verify the
 * state it was handed.
 *
 * WHY THIS EXISTS
 * ---------------
 * qbo-connect generated a state value:
 *
 *     // CSRF state — opaque random + the caller origin so the callback can verify.
 *     const state = crypto.randomUUID() + '.' + btoa(origin || '');
 *
 * and qbo-callback read it:
 *
 *     const state = url.searchParams.get('state') || '';
 *
 * and then used it for nothing. The comment described protection that did not
 * exist: the value was generated, sent to Intuit, echoed back, and dropped.
 *
 * qbo-callback holds SUPABASE_SERVICE_ROLE_KEY and writes qbo_tokens, and
 * Intuit will redirect anyone who completes an authorization. So a stranger
 * who ran the flow against their own QuickBooks company could have the
 * callback overwrite the stored tokens and realm_id — silently repointing the
 * CRM's accounting integration at a company they control. Invoices pushed
 * afterwards go to them.
 *
 * The callback cannot require a staff session: it is a top-level browser
 * redirect from Intuit and carries no Authorization header. The state IS the
 * credential, which is why it has to be stored and checked rather than merely
 * generated.
 *
 * Structural assertions: these are Deno functions that reach Intuit and
 * PostgREST, so they are not unit-testable from node.
 *
 * Run:  node tests/qbo-oauth-state.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const connect  = fs.readFileSync(path.join(ROOT, 'supabase/functions/qbo-connect/index.ts'), 'utf8');
const callback = fs.readFileSync(path.join(ROOT, 'supabase/functions/qbo-callback/index.ts'), 'utf8');

const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter(f => /qbo_oauth_states/.test(f))
  .map(f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'))
  .join('\n');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('QuickBooks OAuth — the state must actually be verified\n');

/* ── the state is persisted ───────────────────────────────────────── */
check('a state store exists',
  /create table if not exists public\.qbo_oauth_states/.test(migrations),
  'no qbo_oauth_states migration found');

check('the state store has RLS enabled',
  /alter table public\.qbo_oauth_states enable row level security/.test(migrations),
  'a readable state table hands an attacker the value this exists to protect');

check('anon and authenticated are revoked from the state store',
  /revoke all on public\.qbo_oauth_states from anon, authenticated/.test(migrations));

check('states expire',
  /expires_at\s+timestamptz not null default \(now\(\) \+ interval/.test(migrations));

/* ── qbo-connect ──────────────────────────────────────────────────── */
check('qbo-connect requires staff',
  /requireStaff/.test(connect) && /if \(!staff\.ok\)/.test(connect),
  'anyone could start an OAuth flow that binds the org accounting integration');

check('qbo-connect writes the state to the store',
  /qbo_oauth_states/.test(connect) && /method: 'POST'/.test(connect));

check('qbo-connect aborts if the state cannot be persisted',
  /if \(!ins\.ok\)[\s\S]{0,300}?return errorResponse/.test(connect),
  'continuing would send the user to Intuit for a state the callback will reject');

/* ── qbo-callback ─────────────────────────────────────────────────── */
check('qbo-callback rejects a missing state',
  /if \(!state\)[\s\S]{0,200}?return errorResponse/.test(callback));

check('qbo-callback looks the state up in the store',
  /qbo_oauth_states\?state=eq\./.test(callback),
  'the state is still read and ignored');

// DELETE ... RETURNING makes check-and-consume atomic; a SELECT followed by a
// DELETE would leave a window in which the same state could be replayed.
check('the state is consumed atomically (DELETE returning the row)',
  /method: 'DELETE'[\s\S]{0,200}?srvHeaders/.test(callback) && /Prefer: 'return=representation'/.test(callback),
  'a select-then-delete leaves a replay window');

check('an unrecognised or already-used state is refused',
  /if \(!stateRow\)[\s\S]{0,300}?return errorResponse/.test(callback));

check('an expired state is refused',
  /expires_at[\s\S]{0,200}?return errorResponse/.test(callback));

// The whole point is that this happens BEFORE the token exchange — verifying
// afterwards would still let a forged flow reach Intuit with the real secret.
check('the state is verified BEFORE the Intuit token exchange',
  (() => {
    const stateAt = callback.indexOf('qbo_oauth_states?state=eq.');
    const exchAt  = callback.indexOf('grant_type');
    return stateAt !== -1 && exchAt !== -1 && stateAt < exchAt;
  })(),
  'the token exchange runs before the state is checked');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
