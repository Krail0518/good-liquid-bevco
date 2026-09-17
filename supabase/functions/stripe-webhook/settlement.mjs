// Pure decisions for stripe-webhook: what a Stripe event means for the ledger.
//
// Kept free of Deno, fetch and the database so Node can import this exact file
// in tests/stripe-webhook-behavior.test.cjs (CI runs Node 20, which cannot load
// TypeScript). index.ts imports it; the tests import it; they cannot drift.

// ── Checkout ─────────────────────────────────────────────────────────────────
// GL-119 (independent review R1). A completed Checkout Session is NOT proof of
// payment. For a bank debit (us_bank_account / ACH) Stripe sends
// checkout.session.completed with payment_status 'unpaid' while the debit is
// still processing, then days later checkout.session.async_payment_succeeded
// or checkout.session.async_payment_failed. The old handler recorded the
// payment on `completed` regardless, so an ACH invoice showed paid before the
// money arrived and stayed paid if the debit failed.
//
// The rule now: settle only when the session itself says payment_status is
// 'paid', from either `completed` or `async_payment_succeeded`.
//
// Idempotency is keyed on the SESSION, not the event. A card payment arrives as
// one `completed` (paid); an ACH payment as `completed` (unpaid) then
// `async_payment_succeeded` (paid). Those are different event ids for the same
// money, so an event-keyed ledger could not tell a redelivery from a second
// payment if both ever reported paid. One session is one payment.
export const SETTLE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
];
export const FAILED_EVENT = 'checkout.session.async_payment_failed';

export function sessionLedgerKey(sessionId) {
  return 'checkout_session:' + String(sessionId || '');
}

export function decideCheckout(type, session) {
  const s = session || {};
  const invoiceNumber = String(s.client_reference_id || (s.metadata && s.metadata.invoice_id) || '').trim();
  const sessionId = s.id ? String(s.id) : '';

  if (type === FAILED_EVENT) {
    return { action: 'failed', invoiceNumber, sessionId, key: sessionLedgerKey(sessionId) };
  }
  if (!SETTLE_EVENTS.includes(type)) return { action: 'not_checkout' };

  if (!invoiceNumber) return { action: 'ignore', reason: 'no invoice id on session', sessionId };
  if (!sessionId) return { action: 'ignore', reason: 'session has no id; cannot settle idempotently', invoiceNumber };

  if (s.payment_status !== 'paid') {
    // 'unpaid' = an ACH debit still processing. 'no_payment_required' never
    // applies to an invoice checkout. Neither is money received.
    return { action: 'pending', invoiceNumber, sessionId, paymentStatus: s.payment_status == null ? null : String(s.payment_status) };
  }

  // GL-101: amount_total includes the card surcharge line; the invoice is
  // settled by the base. base_amount_cents is written server-side by our own
  // checkout function and arrives inside a signature-verified event.
  const totalCents = typeof s.amount_total === 'number' ? s.amount_total : null;
  if (totalCents === null || !(totalCents > 0)) {
    return { action: 'ignore', reason: 'session carries no amount_total', invoiceNumber, sessionId };
  }
  const baseMeta = Number(s.metadata && s.metadata.base_amount_cents);
  const settleCents = Number.isInteger(baseMeta) && baseMeta > 0 && baseMeta <= totalCents ? baseMeta : totalCents;
  const method = Array.isArray(s.payment_method_types) && s.payment_method_types.length
    ? String(s.payment_method_types[0]) : null;

  return {
    action: 'settle',
    invoiceNumber,
    sessionId,
    key: sessionLedgerKey(sessionId),
    amount: settleCents / 100,
    totalCents,
    settleCents,
    currency: String(s.currency || 'usd'),
    method,
  };
}

// ── Refunds ──────────────────────────────────────────────────────────────────
// GL-120 (independent review R2). charge.refunded carries amount_refunded, which
// is CUMULATIVE for the charge. The webhook used to read the prior reversals
// over HTTP, subtract, and send the difference — outside any lock, so two
// refund events processed at once both read "0 so far" and both reversed their
// full share. The subtraction now happens inside gl_apply_stripe_refund, under
// the invoice row lock. This only extracts the figures Stripe sent.
export function refundArgs(eventId, charge) {
  const c = charge || {};
  const md = c.metadata || {};
  const invoiceNumber = String(md.invoice_id || md.invoice_number || '').trim();
  const baseMeta = Number(md.base_amount_cents);
  return {
    invoiceNumber,
    p_event_id: String(eventId || ''),
    p_invoice_number: invoiceNumber,
    p_charge_id: c.id ? String(c.id) : '',
    p_charge_cents: typeof c.amount === 'number' ? c.amount : null,
    p_refunded_cents: typeof c.amount_refunded === 'number' ? c.amount_refunded : null,
    p_base_cents: Number.isInteger(baseMeta) && baseMeta > 0 ? baseMeta : null,
  };
}

// What an RPC verdict means for the HTTP answer to Stripe. A 5xx makes Stripe
// retry, which is right only for a transient failure. A duplicate or an
// already-reflected refund is success. A decline (unknown invoice, over the
// balance) will never succeed on retry and must be surfaced, not retried.
export function verdictOutcome(verdict) {
  const v = verdict || {};
  if (v.applied === true) return 'applied';
  if (v.applied === false && (v.reason === 'duplicate_event' || v.reason === 'already_reflected')) return 'no_op';
  if (v.applied === false) return 'declined';
  return 'unreadable';
}
