#!/usr/bin/env node
/* Stripe payment confirmation emails to the client (2026-11-10).
 *
 * A client paid by ACH and got no confirmation at all; the invoice page kept
 * saying "pending". stripe-webhook now sends a "processing" email when an ACH
 * checkout completes unpaid, and a "paid" confirmation when the ledger applies
 * a payment, each carrying the Stripe reference (PaymentIntent id).
 *
 * This file drives receipt.mjs (the module index.ts imports) and the pending
 * decision in settlement.mjs, then checks the wiring in index.ts: when each
 * email is sent, and that a send can never fail the webhook or repeat on a
 * redelivered event.
 *
 * Run: node tests/stripe-payment-email.test.cjs
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(path.resolve(__dirname, '..'), 'supabase', 'functions', 'stripe-webhook');

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail !== undefined) console.log('        ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)));
}

const DASHES = /[‒–—―]| - /; // owner's copy rule: no dash punctuation

(async () => {
  const R = await import(pathToFileURL(path.join(DIR, 'receipt.mjs')).href);
  const S = await import(pathToFileURL(path.join(DIR, 'settlement.mjs')).href);

  const achSession = {
    id: 'cs_live_abc', payment_intent: 'pi_3QxYz', client_reference_id: 'GL-1042',
    payment_status: 'unpaid', amount_total: 673082, currency: 'usd',
    payment_method_types: ['card', 'us_bank_account'],
    metadata: { invoice_id: 'GL-1042', base_amount_cents: '673082' },
    customer_details: { email: 'payer@example.com', name: 'Jay Giraud' },
  };

  // ── Reference ──────────────────────────────────────────────────────────────
  check('reference is the PaymentIntent id', R.paymentReference(achSession) === 'pi_3QxYz');
  check('reference reads an expanded PaymentIntent object',
    R.paymentReference({ id: 'cs_1', payment_intent: { id: 'pi_obj' } }) === 'pi_obj');
  check('reference falls back to the session id, never empty when a session id exists',
    R.paymentReference({ id: 'cs_only' }) === 'cs_only');

  // ── Pending decision now carries amounts for the email ─────────────────────
  const d = S.decideCheckout('checkout.session.completed', achSession);
  check('unpaid ACH completion is still "pending" (nothing recorded)', d.action === 'pending' && !('key' in d), d);
  check('pending decision carries the amounts for the processing email',
    d.settleCents === 673082 && d.totalCents === 673082, d);
  const card = S.decideCheckout('checkout.session.completed',
    { ...achSession, payment_status: 'paid', amount_total: 693274, metadata: { base_amount_cents: '673082' } });
  check('card settlement still applies the base amount, not the surcharged total',
    card.action === 'settle' && card.amount === 6730.82 && card.totalCents === 693274, card);

  // ── Recipient and greeting ─────────────────────────────────────────────────
  check('client email on file wins over the address typed into Stripe',
    R.recipientEmail('Jay@HouseofTavu.com', achSession) === 'Jay@HouseofTavu.com');
  check('falls back to the Stripe customer email', R.recipientEmail('', achSession) === 'payer@example.com');
  check('a malformed or multi address value is not used as a recipient',
    R.recipientEmail('a@b.com, c@d.com', {}) === '' && R.recipientEmail('nope', {}) === '');
  check('greets by first name from the CRM contact', R.greetingName('Jay Giraud', {}) === 'Jay');
  check('greets by the Stripe name when the CRM has none', R.greetingName('', achSession) === 'Jay');

  // ── Method label ───────────────────────────────────────────────────────────
  check('processing email always says bank transfer, even when the session offered card first',
    R.methodLabel(R.emailMethod('checkout.session.completed', 'processing', 'card')) === 'Bank transfer (ACH)');
  check('async_payment_succeeded confirmation says bank transfer',
    R.methodLabel(R.emailMethod('checkout.session.async_payment_succeeded', 'paid', 'card')) === 'Bank transfer (ACH)');
  check('an instantly paid completion is a card',
    R.methodLabel(R.emailMethod('checkout.session.completed', 'paid', 'card')) === 'Card');

  // ── Processing email ───────────────────────────────────────────────────────
  const at = new Date('2026-11-10T17:10:17Z');
  const p = R.buildPaymentEmail({ kind: 'processing', invoiceNumber: 'GL-1042', name: 'Jay',
    method: 'us_bank_account', reference: 'pi_3QxYz', appliedCents: 673082, chargedCents: 673082, at });
  check('processing subject names the invoice', p.subject === 'Payment received: Invoice GL-1042 (processing)', p.subject);
  check('processing text has the Stripe reference, amount and method',
    /Stripe reference: pi_3QxYz/.test(p.text) && /\$6,730\.82/.test(p.text) && /Bank transfer \(ACH\)/.test(p.text), p.text);
  check('processing text tells the client not to pay again', /do not submit the payment again/.test(p.text));
  check('processing email is addressed by name', p.text.startsWith('Hi Jay,'));
  check('processing email has no dash punctuation', !DASHES.test(p.text), p.text);

  // ── Paid email ─────────────────────────────────────────────────────────────
  const c = R.buildPaymentEmail({ kind: 'paid', invoiceNumber: 'GL-1042', name: 'Jay',
    method: 'card', reference: 'pi_card', appliedCents: 673082, chargedCents: 693274, paidInFull: true, at });
  check('paid subject is a confirmation', c.subject === 'Payment confirmation: Invoice GL-1042', c.subject);
  check('card confirmation shows applied amount, fee and total charged',
    /Amount applied: \$6,730\.82/.test(c.text) && /Card processing fee: \$201\.92/.test(c.text) && /Total charged: \$6,932\.74/.test(c.text), c.text);
  check('paid in full is stated', /is now paid in full/.test(c.text));
  const partial = R.buildPaymentEmail({ kind: 'paid', invoiceNumber: 'GL-1', appliedCents: 100, paidInFull: false, reference: 'pi_x', at });
  check('a partial payment does not claim paid in full', !/paid in full/.test(partial.text) && /balance remains/.test(partial.text));
  check('no name falls back to a plain greeting', partial.text.startsWith('Hello,'));
  check('paid email has no dash punctuation', !DASHES.test(c.text), c.text);

  // ── Escaping: names come from a form a lead filled in ──────────────────────
  const x = R.buildPaymentEmail({ kind: 'paid', invoiceNumber: 'GL-1', name: '<img src=x onerror=alert(1)>',
    appliedCents: 100, reference: 'pi_x', at });
  check('names are HTML escaped in the HTML part', !/<img/.test(x.html) && /&lt;img/.test(x.html));

  // ── Wiring in index.ts ─────────────────────────────────────────────────────
  const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('index.ts imports the email builders from ./receipt.mjs',
    /from '\.\/receipt\.mjs'/.test(src) && /buildPaymentEmail/.test(src));
  const pendingBlock = (src.match(/if \(d\.action === 'pending'\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('processing email is sent only from the pending branch, only for an unpaid completion',
    /checkout\.session\.completed' && d\.paymentStatus === 'unpaid'/.test(pendingBlock) &&
    /sendClientPaymentEmail\('processing'/.test(pendingBlock));
  const settleBlock = (src.match(/if \(d\.action === 'settle'\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('paid email is sent after the duplicate and decline returns (applied only)',
    settleBlock.indexOf("sendClientPaymentEmail('paid'") > settleBlock.indexOf("outcome === 'declined'") &&
    settleBlock.indexOf("outcome === 'no_op'") > -1 && settleBlock.indexOf("sendClientPaymentEmail('paid'") > -1);
  check('exactly two send sites', (src.match(/sendClientPaymentEmail\('/g) || []).length === 2);
  const fn = (src.match(/async function sendClientPaymentEmail[\s\S]*?\n\}\n/) || [''])[0];
  check('the sender catches everything (cannot fail the webhook)', /\n  try \{[\s\S]*\n  \} catch \(e\) \{/.test(fn));
  check('the sender checks email_log for a prior send before sending',
    fn.indexOf('email_log?invoice_number') > -1 && fn.indexOf('email_log?invoice_number') < fn.indexOf('gmail-send'));
  check('if the prior-send check fails, it does not send (no duplicate on an unknown state)',
    /prior === null\) \{[^}]*return;/.test(fn));
  check('the email_log insert is checked for a returned row (rule 4)',
    /return=representation/.test(fn) && /!rows\.length/.test(fn));

  console.log('\n' + (failures ? failures + ' FAILED, ' : '') + passes + ' passed\n');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
