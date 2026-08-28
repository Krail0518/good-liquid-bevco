/*
 * stripe-checkout-auth.test.cjs — the public pay endpoint must not let anyone
 * enumerate invoices.
 *
 * WHY THIS EXISTS
 * ---------------
 * stripe-checkout-session performs a SERVICE-ROLE invoice lookup, which
 * bypasses RLS entirely. It did no caller check at all, and addressed the row
 * by `invoice_number` — a short, sequential, guessable string like "GL-1042".
 *
 * So anyone who could reach the endpoint could walk the invoice-number space
 * and learn, for every client:
 *   - whether an invoice exists        (404 vs 200)
 *   - whether it is paid or voided     (distinct 409 messages)
 *   - its exact amount                 (returned in the session response)
 *
 * It must stay reachable without a CRM login — that is the point of a public
 * pay link — so the fix is not requireStaff() on its own. The caller now has
 * to present something unguessable: the invoice's share_token, or a staff
 * session. Crucially the share_token path looks the row up BY THE TOKEN, so an
 * invoice number stops being an access key and enumeration is closed rather
 * than merely gated.
 *
 * These are structural assertions. The function is Deno/TypeScript and reaches
 * Stripe and PostgREST, so it is not unit-testable from node; what is checked
 * here is that the authorization shape is present and that both callers supply
 * a credential. The behaviour needs a deployed function to exercise.
 *
 * Run:  node tests/stripe-checkout-auth.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fn         = fs.readFileSync(path.join(ROOT, 'supabase/functions/stripe-checkout-session/index.ts'), 'utf8');
const publicCall = fs.readFileSync(path.join(ROOT, 'crm-portal-public.js'), 'utf8');
const staffCall  = fs.readFileSync(path.join(ROOT, 'crm-integrations.js'), 'utf8');
const sharedAuth = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/auth.ts'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('stripe-checkout-session — no unauthenticated invoice enumeration\n');

/* ── the function authorizes ──────────────────────────────────────── */
check('the function requires a credential before looking anything up',
  /share_token/.test(fn) && /requireStaff/.test(fn),
  'neither a share_token path nor requireStaff found');

check('an unauthorized caller is refused',
  /if \(!staff\.ok\)[\s\S]{0,300}?return errorResponse/.test(fn));

check('the share_token path addresses the row BY THE TOKEN, not the number',
  /share_token=eq\.\$\{encodeURIComponent\(String\(share_token\)\)\}/.test(fn),
  'the token is accepted but the lookup still filters on invoice_number, so numbers remain an access key');

check('the staff path still looks up by invoice_number',
  /invoice_number=eq\.\$\{encodeURIComponent\(String\(invoice_id\)\)\}/.test(fn));

// If a valid token for invoice A could be paired with invoice B's number, the
// token check would be decorative.
check('a token and a number that disagree are refused',
  /authMode === 'share_token' && invoice_id && dbNumber && String\(invoice_id\) !== dbNumber/.test(fn),
  'no cross-check between the supplied number and the row the token resolved to');

// The refusal must not itself become an oracle.
check('the unauthorized refusal is indistinguishable from not-found',
  (() => {
    const at = fn.indexOf('if (!staff.ok)');
    if (at === -1) return false;
    return /Invoice not found/.test(fn.slice(at, at + 300));
  })(),
  'a distinct 401 message would still reveal which invoice numbers exist');

/* ── the anon key must not count as authentication ────────────────── */
// supabase-js functions.invoke() attaches the publishable key as the
// Authorization header when the customer has no session, so "a header is
// present" proves nothing.
check('requireStaff rejects the bare anon/publishable key',
  /token === ANON_KEY[\s\S]{0,160}?401/.test(sharedAuth),
  'the shared helper would accept the publishable key as a login');

/* ── both callers supply a credential ─────────────────────────────── */
check('the public pay page sends the share token',
  /share_token: token/.test(publicCall),
  'the public caller sends no credential, so paying an invoice would now 404');

check('the staff caller sends its session token',
  /Authorization: 'Bearer ' \+ token/.test(staffCall));

/* ── the amount still comes from the database ─────────────────────── */
// Pre-existing behaviour that must survive this change: never trust the
// browser-supplied amount.
check('the charge amount is still read from the database, not the request',
  /const chargeAmount = dbAmount;/.test(fn));

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
