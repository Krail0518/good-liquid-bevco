// Payment confirmation emails sent to the client by stripe-webhook.
//
// WHY THIS EXISTS (2026-11-10)
// A client paid an invoice by bank transfer (ACH) through the Stripe link and
// got nothing back: Stripe's checkout page showed no confirmation, the invoice
// page still said "pending", and our webhook only logged the event. The client
// had to email Mike to ask whether the payment worked. A card payment was no
// better: the ledger recorded it and Mike got an alert, but the client got
// nothing from us.
//
// Two emails now go to the client:
//   * "processing"  ACH only. checkout.session.completed arrives with
//                   payment_status 'unpaid' while the bank debit is in flight.
//                   Tells the client we have it and it takes a few business days.
//   * "paid"        Any method, once the ledger has applied the payment
//                   (card at completed, ACH at async_payment_succeeded).
// Both carry the Stripe reference (the PaymentIntent id, pi_...), which is the
// id Stripe support and the client's bank statement lookup work from.
//
// Copy rule from the owner: no dashes as punctuation in client facing text.
//
// Plain ESM, no imports, no I/O: Deno (index.ts) and Node
// (tests/stripe-payment-email.test.cjs) load this same file.

// The id a client or Stripe support can look the payment up by. The
// PaymentIntent id is present on every Checkout Session in payment mode, for
// card and ACH alike; fall back to the session id so an email never goes out
// without a reference.
export function paymentReference(session) {
  const s = session || {};
  const pi = s.payment_intent;
  if (typeof pi === 'string' && pi) return pi;
  if (pi && typeof pi === 'object' && pi.id) return String(pi.id);
  return s.id ? String(s.id) : '';
}

export function methodLabel(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'us_bank_account' || m === 'ach_debit' || m === 'ach') return 'Bank transfer (ACH)';
  if (m === 'card') return 'Card';
  if (m === 'link') return 'Link';
  return m ? m.replace(/_/g, ' ') : 'Online payment';
}

// Which method to name in the email. A session offered both card and bank
// lists both in payment_method_types, so its first entry ('card') says
// nothing about how this client paid. The event does: a 'processing' email or
// an async_payment_succeeded settlement only happens for a bank debit; a
// completed session that is already paid is the card (or other instant) path.
export function emailMethod(eventType, kind, sessionMethod) {
  if (kind === 'processing' || eventType === 'checkout.session.async_payment_succeeded') return 'us_bank_account';
  return sessionMethod === 'us_bank_account' ? 'card' : (sessionMethod || 'card');
}

export function money(cents) {
  const n = Number(cents) / 100;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Who to address. The CRM contact name wins; then the name the payer typed
// into Stripe; then a plain greeting. First word only ("Jay Giraud" -> "Jay").
export function greetingName(contactName, session) {
  const fromStripe = session && session.customer_details && session.customer_details.name;
  const full = String(contactName || fromStripe || '').trim();
  return full ? full.split(/\s+/)[0] : '';
}

// Where to send it. The client's email on file is the billing contact the
// invoice was sent to; the address typed into Stripe is the fallback.
export function recipientEmail(clientEmail, session) {
  const ok = (e) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(String(e || '').trim());
  const s = session || {};
  const candidates = [clientEmail, s.customer_details && s.customer_details.email, s.customer_email];
  for (const c of candidates) if (ok(c)) return String(c).trim();
  return '';
}

export function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Build the client email.
 * opts: {
 *   kind: 'processing' | 'paid',
 *   invoiceNumber, name, method, reference,
 *   appliedCents   amount applied to the invoice (base, without card fee)
 *   chargedCents   amount Stripe charged (base + card fee); may equal applied
 *   paidInFull     boolean | null (paid emails only; from the ledger verdict)
 *   at             Date
 * }
 * Returns { subject, text, html }.
 */
export function buildPaymentEmail(opts) {
  const o = opts || {};
  const inv = String(o.invoiceNumber || '');
  const hi = o.name ? 'Hi ' + o.name + ',' : 'Hello,';
  const applied = money(o.appliedCents);
  const fee = Number(o.chargedCents) > Number(o.appliedCents) ? Number(o.chargedCents) - Number(o.appliedCents) : 0;
  const date = fmtDate(o.at instanceof Date ? o.at : new Date());

  let subject, lead, after;
  if (o.kind === 'processing') {
    subject = 'Payment received: Invoice ' + inv + ' (processing)';
    lead = 'We received your bank payment of ' + applied + ' for Invoice ' + inv + '. ' +
      'Bank payments take a few business days to clear. There is nothing else you need to do, ' +
      'and please do not submit the payment again.';
    after = 'You will get a second email from us once the payment has cleared.';
  } else {
    subject = 'Payment confirmation: Invoice ' + inv;
    lead = 'Your payment of ' + applied + ' for Invoice ' + inv + ' has gone through. Thank you.';
    after = o.paidInFull === true ? 'Invoice ' + inv + ' is now paid in full.'
      : o.paidInFull === false ? 'This payment has been applied to Invoice ' + inv + '. A balance remains on the invoice.'
      : '';
  }

  const rows = [
    ['Stripe reference', o.reference || ''],
    ['Invoice', inv],
    [o.kind === 'processing' ? 'Amount' : 'Amount applied', applied],
  ];
  if (fee) {
    rows.push(['Card processing fee', money(fee)]);
    rows.push(['Total charged', money(o.chargedCents)]);
  }
  rows.push(['Payment method', methodLabel(o.method)]);
  rows.push([o.kind === 'processing' ? 'Submitted' : 'Date', date]);
  if (o.kind === 'processing') rows.push(['Status', 'Processing']);

  const text = [
    hi, '',
    lead, '',
    ...rows.map(([k, v]) => k + ': ' + v), '',
    ...(after ? [after, ''] : []),
    'Keep this email for your records. If you have any questions, reply to this email and include the Stripe reference.', '',
    'Good Liquid Bev Co',
    '2011 51st Ave E, Unit 100, Palmetto, FL 34221',
  ].join('\n');

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2433">
<div style="font-size:13px;letter-spacing:2px;color:#1a6fff;font-weight:800;margin-bottom:14px">GOOD LIQUID BEV CO</div>
<p>${escHtml(hi)}</p>
<p>${escHtml(lead)}</p>
<table style="border-collapse:collapse;margin:18px 0;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:6px 18px 6px 0;color:#5a6779">${escHtml(k)}</td><td style="padding:6px 0;font-weight:600">${escHtml(v)}</td></tr>`).join('\n')}
</table>
${after ? `<p>${escHtml(after)}</p>` : ''}
<p style="font-size:13px;color:#5a6779">Keep this email for your records. If you have any questions, reply to this email and include the Stripe reference.</p>
<p style="font-size:12px;color:#7a8799;margin-top:28px">Good Liquid Bev Co · 2011 51st Ave E, Unit 100, Palmetto, FL 34221</p></div>`;

  return { subject, text, html };
}
