// stripe-webhook — receives Stripe events and records them in the payment ledger.
//
// Configure in Stripe Dashboard → Developers → Webhooks:
//   Endpoint URL: https://<your-supabase-project>.supabase.co/functions/v1/stripe-webhook
//   Events (ALL FOUR are required — GL-119):
//     checkout.session.completed
//     checkout.session.async_payment_succeeded   bank (ACH) debits settle here, days later
//     checkout.session.async_payment_failed      a bank debit that bounced
//     charge.refunded
//   Without the two async events an ACH invoice is never marked paid: its
//   `completed` event arrives with payment_status 'unpaid' and is only logged.
//
// Secrets required:
//   STRIPE_WEBHOOK_SECRET    — whsec_… (shown once when you create the endpoint)
//   SUPABASE_URL             — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
//
// Deploy through the "Deploy Supabase" workflow (CLAUDE.md), with JWT
// verification off: Stripe sends no Supabase JWT; the Stripe signature header
// (HMAC) is the authentication.
//
// Notes:
//   * Invoice lookup uses `client_reference_id` or `metadata.invoice_id`
//     from the checkout session, which the stripe-checkout-session
//     function sets to the human-readable invoice_number (e.g. GL-1042).
//   * Every ledger write is idempotent in the database: a payment is keyed on
//     its checkout SESSION; a refund on its event, under the invoice row lock.
//   * The client gets a payment email (ACH "processing", then "paid"; card
//     "paid") built in ./receipt.mjs; see sendClientPaymentEmail below.
//   * What each event MEANS is decided in ./settlement.mjs, which Node imports
//     in tests/stripe-webhook-behavior.test.cjs, so the tested code is this code.

import { corsHeaders } from '../_shared/cors.ts';
import { notifyDeal } from '../_shared/notify.ts';
import { decideCheckout, refundArgs, verdictOutcome } from './settlement.mjs';
import { buildPaymentEmail, paymentReference, greetingName, recipientEmail, emailMethod } from './receipt.mjs';

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/**
 * Verify a Stripe webhook signature. Stripe sends a header like:
 *   stripe-signature: t=1714770000,v1=abc123…
 * The expected signature is HMAC-SHA256(secret, `${timestamp}.${raw_body}`).
 *
 * We accept a 5-minute timestamp tolerance to allow for clock skew.
 */
async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
): Promise<{ ok: boolean; reason?: string; timestamp?: number }> {
  if (!sigHeader) return { ok: false, reason: 'missing stripe-signature header' };
  if (!secret) return { ok: false, reason: 'webhook secret not configured' };

  const parts = sigHeader.split(',').map(p => p.trim());
  const tsPart = parts.find(p => p.startsWith('t='));
  const sigParts = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!tsPart || !sigParts.length) return { ok: false, reason: 'malformed stripe-signature' };

  const timestamp = parseInt(tsPart.slice(2), 10);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'bad timestamp in signature' };
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > 300) return { ok: false, reason: `timestamp too old (${Math.round(ageSeconds)}s)` };

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  const macHex = Array.from(new Uint8Array(macBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  for (const provided of sigParts) {
    if (constantTimeEqual(macHex, provided)) return { ok: true, timestamp };
  }
  return { ok: false, reason: 'signature mismatch' };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/* Every ledger write goes through a SECURITY DEFINER RPC, never a PATCH of
   `invoices`. The RPCs lock the invoice, refuse replays and derive status in
   one transaction. This function used to PATCH status='paid' directly, and
   every Stripe redelivery re-applied the payment (graded CRITICAL). */
async function rpc(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string; verdict: any }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let verdict: any = null;
  try { verdict = JSON.parse(text); } catch { /* keep the raw text for the log */ }
  return { ok: r.ok, status: r.status, text, verdict };
}

/* ── Client payment confirmation email (receipt.mjs has the why) ──────────────
   Best effort by design: the ledger write is the source of truth and has
   already happened (or, for "processing", nothing is recorded at all). A
   failed lookup or send is logged and never changes the answer to Stripe,
   because a 5xx would make Stripe redeliver an event that was handled.

   Sent at most once per (invoice, kind, Stripe reference): email_log is
   checked first. Stripe can redeliver an event; the "paid" email is also
   gated on the ledger verdict being 'applied', which a redelivery never gets. */
async function restGet(path: string): Promise<any[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) { console.error('[stripe-webhook] lookup failed:', path.split('?')[0], r.status); return null; }
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  } catch (e) {
    console.error('[stripe-webhook] lookup threw:', path.split('?')[0], String(e));
    return null;
  }
}

async function sendClientPaymentEmail(kind: 'processing' | 'paid', ctx: {
  type: string; invoiceNumber?: string | null; session: any;
  appliedCents?: number | null; chargedCents?: number | null; method?: string | null;
  paidInFull: boolean | null;
}): Promise<void> {
  const template = kind === 'processing' ? 'stripe_payment_processing' : 'stripe_payment_confirmation';
  try {
    const reference = paymentReference(ctx.session);
    if (!ctx.invoiceNumber || !reference || !(Number(ctx.appliedCents) > 0)) {
      console.warn('[stripe-webhook]', template, 'skipped: missing invoice, reference or amount', ctx.invoiceNumber);
      return;
    }
    const invoiceNumber = String(ctx.invoiceNumber);
    const invRows = await restGet(`invoices?invoice_number=eq.${encodeURIComponent(invoiceNumber)}&select=id,client_id&limit=1`);
    const inv = invRows && invRows[0];
    if (!inv) { console.warn('[stripe-webhook]', template, 'skipped: invoice not found', ctx.invoiceNumber); return; }

    const cliRows = inv.client_id
      ? await restGet(`clients?id=eq.${encodeURIComponent(inv.client_id)}&select=email,contact_name&limit=1`)
      : [];
    const cli = (cliRows && cliRows[0]) || {};
    const to = recipientEmail(cli.email, ctx.session);
    if (!to) { console.warn('[stripe-webhook]', template, 'skipped: no client email on file or in Stripe', ctx.invoiceNumber); return; }

    // Already sent for this payment? (redelivered event)
    const prior = await restGet(`email_log?invoice_number=eq.${encodeURIComponent(invoiceNumber)}` +
      `&template_name=eq.${template}&body_preview=like.${encodeURIComponent('*' + reference + '*')}&select=id&limit=1`);
    if (prior === null) { console.error('[stripe-webhook]', template, 'not sent: could not check for a prior send', ctx.invoiceNumber); return; }
    if (prior.length) { console.log('[stripe-webhook]', template, 'already sent for', reference); return; }

    const email = buildPaymentEmail({
      kind, invoiceNumber,
      name: greetingName(cli.contact_name, ctx.session),
      method: emailMethod(ctx.type, kind, ctx.method),
      reference,
      appliedCents: ctx.appliedCents,
      chargedCents: ctx.chargedCents ?? ctx.appliedCents,
      paidInFull: ctx.paidInFull,
      at: new Date(),
    });

    // Through the CRM's connected Gmail, like every other client email
    // (agreement-sign does the same). gmail-send accepts the service-role
    // bearer as an internal call.
    const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
      body: JSON.stringify({ to, subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok || j.ok !== true) {
      console.error('[stripe-webhook]', template, 'gmail-send failed:', r.status, j && j.error);
      return;
    }

    // Log it so it shows in the client's email activity, and so a redelivery
    // finds it above. Rule 4: an insert that returns no row did not happen.
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/email_log`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify([{
        mailgun_id: (j.id as string) || null, to_email: to, subject: email.subject,
        body_preview: email.text.slice(0, 4000), template_name: template,
        invoice_id: inv.id, invoice_number: invoiceNumber, client_id: inv.client_id || null,
        direction: 'outbound', status: 'sent', sent_at: new Date().toISOString(),
      }]),
    });
    const rows = await ins.json().catch(() => null);
    if (!ins.ok || !Array.isArray(rows) || !rows.length) {
      console.error('[stripe-webhook]', template, 'sent but email_log insert failed:', ins.status);
    }
    console.log('[stripe-webhook]', template, 'sent:', ctx.invoiceNumber, reference);
  } catch (e) {
    console.error('[stripe-webhook]', template, 'threw:', String(e));
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  const v = await verifyStripeSignature(raw, sig, WEBHOOK_SECRET);
  if (!v.ok) {
    console.warn('[stripe-webhook] signature verify failed:', v.reason);
    return json({ error: v.reason }, 400);
  }

  let event: any;
  try { event = JSON.parse(raw); } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const type = event?.type as string | undefined;
  const obj  = event?.data?.object || {};

  console.log('[stripe-webhook] verified event:', event?.id, type);

  // ── Checkout: completed / async_payment_succeeded / async_payment_failed ──
  const d = decideCheckout(type, obj);

  if (d.action === 'ignore') {
    console.warn('[stripe-webhook] checkout event ignored:', d.reason, obj.id);
    return json({ ok: true, note: d.reason + ', ignored' });
  }

  if (d.action === 'pending') {
    // GL-119: a bank debit still processing. Recording it here is what marked
    // unpaid ACH invoices paid. async_payment_succeeded will settle it.
    console.log('[stripe-webhook] checkout completed but not yet paid; waiting for settlement:',
      d.invoiceNumber, d.sessionId, 'payment_status=' + d.paymentStatus);
    // Tell the client we have it. Only for the bank debit case: 'unpaid' on a
    // completed session means the debit is in flight.
    if (type === 'checkout.session.completed' && d.paymentStatus === 'unpaid') {
      await sendClientPaymentEmail('processing', {
        type, invoiceNumber: d.invoiceNumber, session: obj,
        appliedCents: d.settleCents, chargedCents: d.totalCents, method: d.method, paidInFull: null,
      });
    }
    return json({ ok: true, note: 'payment not settled yet; nothing recorded', payment_status: d.paymentStatus });
  }

  if (d.action === 'failed') {
    if (!d.invoiceNumber || !d.sessionId || !event?.id) {
      console.warn('[stripe-webhook] async_payment_failed without invoice, session or event id:', obj.id);
      return json({ ok: true, note: 'failed payment without ids, ignored' });
    }
    const r = await rpc('gl_reverse_stripe_session', {
      p_event_id: String(event.id),
      p_invoice_number: d.invoiceNumber,
      p_session_id: d.sessionId,
    });
    if (!r.ok) {
      console.error('[stripe-webhook] failed-payment reversal errored:', r.status, r.text);
      return json({ error: 'failed-payment reversal errored', status: r.status }, 500);
    }
    const outcome = verdictOutcome(r.verdict);
    if (outcome === 'unreadable') {
      console.error('[stripe-webhook] failed-payment reversal returned no verdict:', r.text);
      return json({ error: 'unreadable ledger verdict' }, 500);
    }
    if (outcome === 'declined') console.error('[stripe-webhook] failed-payment reversal declined:', r.text);
    else console.log('[stripe-webhook] bank payment failed:', d.invoiceNumber, r.text);
    return json({ ok: outcome !== 'declined', type: 'payment_failed', verdict: r.verdict });
  }

  if (d.action === 'settle') {
    if (d.settleCents !== d.totalCents) {
      console.log('[stripe-webhook] settling base amount without surcharge:', d.settleCents, 'of', d.totalCents);
    }
    const applied = await rpc('gl_apply_payment_event', {
      p_provider: 'stripe',
      // GL-119: keyed on the SESSION. An ACH payment reaches us as two events
      // (completed, then async_payment_succeeded); a card payment as one. Either
      // way it is one payment, and a redelivery of any of them is a duplicate.
      p_event_id: d.key,
      p_invoice_number: d.invoiceNumber,
      p_amount: d.amount,
      p_currency: d.currency,
      p_method: d.method,
      p_reference: d.sessionId,
    });
    if (!applied.ok) {
      console.error('[stripe-webhook] ledger apply failed:', applied.status, applied.text);
      return json({ error: 'invoice update failed', status: applied.status, text: applied.text }, 500);
    }
    const outcome = verdictOutcome(applied.verdict);
    if (outcome === 'unreadable') {
      console.error('[stripe-webhook] ledger returned no verdict:', applied.text);
      return json({ error: 'unreadable ledger verdict' }, 500);
    }
    // A duplicate is a success. Returning 500 would make Stripe retry an event
    // that has already been applied correctly, forever.
    if (outcome === 'no_op') {
      console.log('[stripe-webhook] duplicate payment ignored:', event?.id, d.key, d.invoiceNumber);
      return json({ ok: true, note: 'duplicate event, already applied' });
    }
    // Unknown invoice, unsupported currency, more than the balance: never
    // retryable, so surface it for a human instead of retrying or swallowing.
    if (outcome === 'declined') {
      console.error('[stripe-webhook] payment declined by ledger:', applied.text);
      return json({ ok: false, declined: applied.verdict });
    }
    console.log('[stripe-webhook] payment applied:', d.invoiceNumber, '$' + d.amount, 'status=' + applied.verdict.status);
    // "Invoice paid" alert to Mike (Telegram + email). Awaited and checked via
    // notifyDeal, which uses the Vault notify secret: this used to be
    // fire-and-forget with the env GL_NOTIFY_SECRET, which notify-deal no
    // longer accepts once the Vault value exists. A failed alert is logged and
    // never fails the webhook (the payment is already recorded).
    await notifyDeal('stripe-webhook', 'invoice_paid_stripe',
      { invoice_number: String(d.invoiceNumber ?? ''), amount: String(d.amount ?? ''), paid_method: d.method || 'card' });
    // Confirmation to the client. Only here, on 'applied': a duplicate
    // returned above and never reaches this line.
    const status = applied.verdict && applied.verdict.status;
    await sendClientPaymentEmail('paid', {
      type: String(type), invoiceNumber: d.invoiceNumber, session: obj,
      appliedCents: d.settleCents, chargedCents: d.totalCents, method: d.method,
      paidInFull: status === 'paid' ? true : (status ? false : null),
    });
    return json({ ok: true, invoice: d.invoiceNumber, amount: d.amount });
  }

  // ── charge.refunded ────────────────────────────────────────────────────────
  if (type === 'charge.refunded') {
    const a = refundArgs(event?.id, obj);
    if (!a.invoiceNumber) {
      console.warn('[stripe-webhook] charge.refunded: no invoice_number in charge metadata, skipping');
      return json({ ok: true, type: 'refund', note: 'no invoice id, ignored' });
    }
    if (!a.p_event_id || !a.p_charge_id || a.p_charge_cents === null || a.p_refunded_cents === null) {
      console.error('[stripe-webhook] charge.refunded missing id or amounts:', event?.id, obj.id);
      return json({ ok: false, type: 'refund', note: 'refund event missing id or amounts; not recorded' });
    }
    // GL-120: the cumulative-to-delta subtraction happens inside the RPC, under
    // the invoice row lock. It used to be a separate HTTP read here, and two
    // refund events at once both read the same prior total.
    const r = await rpc('gl_apply_stripe_refund', {
      p_event_id: a.p_event_id,
      p_invoice_number: a.p_invoice_number,
      p_charge_id: a.p_charge_id,
      p_charge_cents: a.p_charge_cents,
      p_refunded_cents: a.p_refunded_cents,
      p_base_cents: a.p_base_cents,
    });
    if (!r.ok) {
      console.error('[stripe-webhook] refund apply failed:', r.status, r.text);
      return json({ error: 'refund failed', status: r.status, text: r.text }, 500);
    }
    const outcome = verdictOutcome(r.verdict);
    if (outcome === 'unreadable') {
      console.error('[stripe-webhook] refund returned no verdict:', r.text);
      return json({ error: 'unreadable ledger verdict' }, 500);
    }
    if (outcome === 'declined') {
      console.error('[stripe-webhook] refund declined by ledger:', r.text);
      return json({ ok: false, type: 'refund', declined: r.verdict });
    }
    console.log('[stripe-webhook] refund handled:', a.invoiceNumber, r.text);
    return json({ ok: true, type: 'refund', verdict: r.verdict });
  }

  // Anything else: acknowledge so Stripe doesn't retry, but log it.
  return json({ ok: true, ignored: type });
});
