#!/usr/bin/env node
/* Stripe webhook — what each event does to the ledger (GL-119, GL-120).
 *
 * Independent review, 17 September 2026:
 *   R1  An unpaid ACH checkout was recorded as a payment. The webhook checked
 *       the amount, never payment_status, and ignored the async events.
 *   R2  Two partial refunds processed at once both read "nothing refunded yet"
 *       over HTTP and both reversed their share: $50 where $30 was right.
 *
 * The reviewer's note on the earlier suite was fair: it was mostly source
 * patterns, and green source checks did not catch either defect. This file is
 * behavioural. It imports supabase/functions/stripe-webhook/settlement.mjs —
 * the module index.ts imports — and drives Stripe event SEQUENCES through it
 * against a ledger model that applies the same rules as the SQL functions
 * (one row per session key; cumulative refunds reconciled per charge).
 *
 * Division of evidence, so nobody mistakes this for the whole proof:
 *   - this file:                          what the webhook decides, event by event
 *   - scripts/stripe-settlement-proof.sql what the database does (live, rolled back)
 *   - scripts/stripe-refund-concurrency.sh two real sessions, timed on the lock
 * A handful of wiring checks at the end make sure index.ts actually routes
 * through the module and the locked RPCs; they are the only source patterns.
 *
 * Run: node tests/stripe-webhook-behavior.test.cjs
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'supabase', 'functions', 'stripe-webhook');

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail !== undefined) console.log('        ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)));
}

// ── A ledger with the database's rules, driven by the module's decisions ────
// Mirrors gl_apply_payment_event (unique provider_event_id), gl_apply_stripe_refund
// (cumulative target minus prior reversals for the charge, computed under the
// lock — so here, sequentially) and gl_reverse_stripe_session.
function makeLedger(invoiceAmount) {
  const rows = [];
  const net = () => Math.round(rows.reduce((s, r) => s + r.cents, 0));
  return {
    rows, net,
    pay(key, cents, reference) {
      if (rows.some(r => r.key === key)) return { applied: false, reason: 'duplicate_event' };
      if (net() + cents > invoiceAmount) return { applied: false, reason: 'exceeds_balance' };
      rows.push({ key, cents, kind: 'payment', reference });
      return { applied: true, reason: 'applied' };
    },
    refund(a) {
      if (rows.some(r => r.key === a.p_event_id)) return { applied: false, reason: 'duplicate_event' };
      const base = a.p_base_cents && a.p_base_cents <= a.p_charge_cents ? a.p_base_cents : a.p_charge_cents;
      const target = Math.min(base, Math.round(a.p_refunded_cents * base / a.p_charge_cents));
      const prior = -rows.filter(r => r.kind === 'reversal' && r.reference === a.p_charge_id).reduce((s, r) => s + r.cents, 0);
      const delta = target - prior;
      if (delta <= 0) return { applied: false, reason: 'already_reflected' };
      if (net() - delta < 0) return { applied: false, reason: 'exceeds_refundable' };
      rows.push({ key: a.p_event_id, cents: -delta, kind: 'reversal', reference: a.p_charge_id });
      return { applied: true, reason: 'refunded', refunded_cents: delta };
    },
    reverseSession(eventId, sessionId, sessionKey) {
      if (rows.some(r => r.key === eventId)) return { applied: false, reason: 'duplicate_event' };
      const paid = rows.filter(r => r.kind === 'payment' && (r.key === sessionKey || r.reference === sessionId)).reduce((s, r) => s + r.cents, 0);
      const rev = -rows.filter(r => r.kind === 'reversal' && r.reference === sessionId).reduce((s, r) => s + r.cents, 0);
      if (paid - rev <= 0) return { applied: false, reason: 'already_reflected' };
      rows.push({ key: eventId, cents: -(paid - rev), kind: 'reversal', reference: sessionId });
      return { applied: true, reason: 'payment_failed_reversed' };
    },
  };
}

// What index.ts does with a decision, minus HTTP. Returns the ledger calls made.
function deliver(S, ledger, event) {
  const d = S.decideCheckout(event.type, event.data.object);
  if (d.action === 'settle') return { d, v: ledger.pay(d.key, d.settleCents, d.sessionId) };
  if (d.action === 'failed') return { d, v: ledger.reverseSession(event.id, d.sessionId, d.key) };
  if (event.type === 'charge.refunded') {
    const a = S.refundArgs(event.id, event.data.object);
    return { d: { action: 'refund' }, v: ledger.refund(a) };
  }
  return { d, v: null };
}

const session = (over = {}) => ({
  id: 'cs_test_1', client_reference_id: 'GL-1042', amount_total: 10000, currency: 'usd',
  payment_method_types: ['us_bank_account'], metadata: { invoice_id: 'GL-1042', base_amount_cents: '10000' },
  payment_status: 'paid', ...over,
});
const ev = (id, type, object) => ({ id, type, data: { object } });

(async () => {
  console.log('\nStripe webhook — ledger behaviour (R1, R2)\n');
  const S = await import(pathToFileURL(path.join(DIR, 'settlement.mjs')).href);

  // ── R1 ────────────────────────────────────────────────────────────────────
  {
    const L = makeLedger(10000);
    const r = deliver(S, L, ev('evt_1', 'checkout.session.completed', session({ payment_status: 'unpaid' })));
    check('R1: completed with payment_status unpaid (ACH processing) records NO payment',
      r.d.action === 'pending' && r.v === null && L.net() === 0, { decision: r.d, net: L.net() });

    const f = deliver(S, L, ev('evt_2', 'checkout.session.async_payment_failed', session({ payment_status: 'unpaid' })));
    check('R1: a later async_payment_failed leaves no false paid balance',
      f.d.action === 'failed' && L.net() === 0, { decision: f.d, verdict: f.v, net: L.net() });
  }
  {
    const L = makeLedger(10000);
    deliver(S, L, ev('evt_1', 'checkout.session.completed', session({ payment_status: 'unpaid' })));
    const ok = deliver(S, L, ev('evt_2', 'checkout.session.async_payment_succeeded', session()));
    check('R1: async_payment_succeeded records exactly one payment of the base',
      ok.v && ok.v.applied && L.net() === 10000 && L.rows.length === 1, { verdict: ok.v, rows: L.rows });

    const dup1 = deliver(S, L, ev('evt_2', 'checkout.session.async_payment_succeeded', session()));
    const dup2 = deliver(S, L, ev('evt_3', 'checkout.session.completed', session()));
    check('R1: redelivery, and a paid completed for the same session, add nothing',
      dup1.v.reason === 'duplicate_event' && dup2.v.reason === 'duplicate_event' && L.rows.length === 1,
      { dup1: dup1.v, dup2: dup2.v, rows: L.rows.length });
  }
  {
    const L = makeLedger(10000);
    // Reordered: success delivered before the unpaid completed.
    deliver(S, L, ev('evt_2', 'checkout.session.async_payment_succeeded', session()));
    const late = deliver(S, L, ev('evt_1', 'checkout.session.completed', session({ payment_status: 'unpaid' })));
    check('R1: a stale unpaid completed arriving after success changes nothing',
      late.d.action === 'pending' && L.net() === 10000 && L.rows.length === 1, { net: L.net() });
  }
  {
    const L = makeLedger(10000);
    const card = deliver(S, L, ev('evt_c', 'checkout.session.completed',
      session({ id: 'cs_card', payment_method_types: ['card'], amount_total: 10300 })));
    check('card: a paid completed settles the $100 base, not the $103 with surcharge',
      card.v.applied && L.net() === 10000, { decision: card.d, net: L.net() });
  }
  {
    const d = S.decideCheckout('checkout.session.completed', session({ payment_status: 'no_payment_required' }));
    check('only payment_status "paid" settles (no_payment_required does not)', d.action === 'pending', d);
    const d2 = S.decideCheckout('checkout.session.completed', session({ payment_status: undefined }));
    check('a session with no payment_status at all does not settle', d2.action === 'pending', d2);
    const d3 = S.decideCheckout('checkout.session.completed', session({ id: undefined }));
    check('a session with no id is refused rather than settled without an idempotency key', d3.action === 'ignore', d3);
    check('the settlement key is the session, identical for completed and async_payment_succeeded',
      S.decideCheckout('checkout.session.completed', session()).key ===
      S.decideCheckout('checkout.session.async_payment_succeeded', session()).key);
  }

  // ── R2 ────────────────────────────────────────────────────────────────────
  const charge = (refunded) => ({
    id: 'ch_1', amount: 10300, amount_refunded: refunded,
    metadata: { invoice_id: 'GL-1042', base_amount_cents: '10000' },
  });
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const L = makeLedger(10000);
    L.pay('checkout_session:cs_card', 10000, 'cs_card');
    const events = { a: ev('evt_r1', 'charge.refunded', charge(2060)), b: ev('evt_r2', 'charge.refunded', charge(3090)) };
    for (const k of order) deliver(S, L, events[k]);
    const reversed = 10000 - L.net();
    check(`R2: cumulative $20.60 and $30.90 of a $103 charge reverse exactly $30 (order ${order.join(' then ')})`,
      reversed === 3000, { reversed_cents: reversed, rows: L.rows });
  }
  {
    const L = makeLedger(10000);
    L.pay('checkout_session:cs_card', 10000, 'cs_card');
    deliver(S, L, ev('evt_r1', 'charge.refunded', charge(2060)));
    deliver(S, L, ev('evt_r1', 'charge.refunded', charge(2060)));
    deliver(S, L, ev('evt_r2', 'charge.refunded', charge(3090)));
    deliver(S, L, ev('evt_r2', 'charge.refunded', charge(3090)));
    check('R2: redelivered refund events do not add reversals', 10000 - L.net() === 3000, { rows: L.rows });
    const full = deliver(S, L, ev('evt_r3', 'charge.refunded', charge(10300)));
    check('R2: a full refund reverses the rest of the base and lands on zero, not below',
      full.v.refunded_cents === 7000 && L.net() === 0, { verdict: full.v, net: L.net() });
  }
  {
    const a = S.refundArgs('evt_x', charge(2060));
    check('R2: the webhook passes the CUMULATIVE figure and charge, not a computed delta',
      a.p_refunded_cents === 2060 && a.p_charge_cents === 10300 && a.p_base_cents === 10000 && a.p_charge_id === 'ch_1' &&
      !('p_amount' in a), a);
  }

  // ── Verdict handling (review: "handle non-applied RPC verdicts explicitly") ─
  check('verdict: applied', S.verdictOutcome({ applied: true }) === 'applied');
  check('verdict: duplicate and already-reflected are no-ops (200, no retry)',
    S.verdictOutcome({ applied: false, reason: 'duplicate_event' }) === 'no_op' &&
    S.verdictOutcome({ applied: false, reason: 'already_reflected' }) === 'no_op');
  check('verdict: unknown invoice / over balance are declines, not successes',
    S.verdictOutcome({ applied: false, reason: 'unknown_invoice' }) === 'declined' &&
    S.verdictOutcome({ applied: false, reason: 'exceeds_refundable' }) === 'declined');
  check('verdict: an HTTP 200 with no readable verdict is not success',
    S.verdictOutcome(null) === 'unreadable' && S.verdictOutcome({}) === 'unreadable');

  // ── Wiring: index.ts must actually use the module and the locked RPCs ──────
  const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('index.ts imports decideCheckout, refundArgs and verdictOutcome from ./settlement.mjs',
    /import \{[^}]*decideCheckout[^}]*refundArgs[^}]*verdictOutcome[^}]*\} from '\.\/settlement\.mjs'/.test(src));
  check('index.ts records payments with the session key from the decision',
    /rpc\('gl_apply_payment_event'[\s\S]{0,400}p_event_id:\s*d\.key/.test(src));
  check('index.ts sends refunds to the locked gl_apply_stripe_refund, not the caller-computed RPC',
    /rpc\('gl_apply_stripe_refund'/.test(src) && !/gl_apply_refund_event/.test(src));
  check('index.ts no longer reads prior refunds over HTTP (the unlocked read R2 exploited)',
    !/rest\/v1\/invoice_payments/.test(src));
  check('index.ts reverses a failed bank debit through gl_reverse_stripe_session',
    /rpc\('gl_reverse_stripe_session'/.test(src));
  check('index.ts has no path that records a payment outside decision "settle"',
    (src.match(/gl_apply_payment_event/g) || []).length === 1 &&
    /if \(d\.action === 'settle'\) \{[\s\S]*rpc\('gl_apply_payment_event'/.test(src));

  // The scan still finds something: a mutant that settles unpaid sessions must fail.
  const mutant = fs.readFileSync(path.join(DIR, 'settlement.mjs'), 'utf8')
    .replace("if (s.payment_status !== 'paid')", 'if (false)');
  const tmp = path.join(require('os').tmpdir(), 'gl-settlement-mutant-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, mutant);
  try {
    const M = await import(pathToFileURL(tmp).href);
    check('mutant that ignores payment_status is caught by the R1 scenario',
      M.decideCheckout('checkout.session.completed', session({ payment_status: 'unpaid' })).action === 'settle');
  } finally { try { fs.unlinkSync(tmp); } catch {} }

  console.log('\n' + (failures ? failures + ' FAILED, ' : '') + passes + ' passed\n');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
