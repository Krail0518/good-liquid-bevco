// stripe-webhook — receives Stripe events and marks invoices paid.
//
// Configure in Stripe Dashboard → Developers → Webhooks:
//   Endpoint URL: https://<your-supabase-project>.supabase.co/functions/v1/stripe-webhook
//   Events:       checkout.session.completed
//                 charge.refunded                     (optional, marks invoice unpaid)
//
// Secrets required:
//   STRIPE_WEBHOOK_SECRET    — whsec_… (shown once when you create the endpoint)
//   SUPABASE_URL             — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
//
// Notes:
//   * --no-verify-jwt is REQUIRED — Stripe doesn't send a Supabase JWT.
//     Authentication happens via the Stripe signature header (HMAC).
//   * Invoice lookup uses `client_reference_id` or `metadata.invoice_id`
//     from the checkout session, which the stripe-checkout-session
//     function already sets to the human-readable invoice_number (e.g. GL-1042).
//   * Idempotent: re-receiving the same event for an already-paid
//     invoice is a no-op and still returns 200.

import { corsHeaders } from '../_shared/cors.ts';

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

/* Apply a Stripe payment through the ledger RPC rather than PATCHing the
   invoice. The RPC locks the invoice, refuses a replay on (provider, event_id),
   records an immutable ledger row and derives status -- all in one transaction.

   This function used to PATCH `invoices` with status='paid' directly. Stripe
   retries a webhook for up to three days, so every redelivery re-applied the
   same payment; there was no ledger row, and nothing tied the write to the
   event that caused it. The external audit graded that CRITICAL and it was the
   one item this system could not answer for. */
async function applyPaymentEvent(args: {
  eventId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  method: string | null;
  sessionId: string | null;
}): Promise<{ ok: boolean; status: number; text: string; verdict: any }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gl_apply_payment_event`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_provider: 'stripe',
      p_event_id: args.eventId,
      p_invoice_number: args.invoiceNumber,
      p_amount: args.amount,
      p_currency: args.currency,
      p_method: args.method,
      p_reference: args.sessionId,
    }),
  });
  const text = await r.text();
  let verdict: any = null;
  try { verdict = JSON.parse(text); } catch { /* keep the raw text for the log */ }
  return { ok: r.ok, status: r.status, text, verdict };
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
    return new Response(JSON.stringify({ error: v.reason }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const type = event?.type as string | undefined;
  const obj  = event?.data?.object || {};

  console.log('[stripe-webhook] verified event:', event?.id, type);

  // checkout.session.completed → mark invoice paid
  if (type === 'checkout.session.completed') {
    const invoiceNumber: string =
      String(obj.client_reference_id || obj.metadata?.invoice_id || '').trim();
    if (!invoiceNumber) {
      console.warn('[stripe-webhook] no invoice id on session', obj.id);
      return new Response(JSON.stringify({ ok: true, note: 'no invoice id, ignored' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const amount = typeof obj.amount_total === 'number' ? obj.amount_total / 100 : null;
    const paidMethod = Array.isArray(obj.payment_method_types) && obj.payment_method_types.length
      ? String(obj.payment_method_types[0]) : null;

    // The amount has to be a real figure before it can become a ledger entry.
    // A session with no amount_total is not evidence of a payment.
    if (amount === null || !(amount > 0)) {
      console.warn('[stripe-webhook] session carries no amount_total, ignored:', obj.id);
      return new Response(JSON.stringify({ ok: true, note: 'no amount on session, ignored' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const applied = await applyPaymentEvent({
      // Keyed on the EVENT id, not the session id: Stripe reuses a session
      // across redeliveries of the same event, and it is the event that is
      // replayed. A null id would defeat idempotency, so fall back to the
      // session rather than sending nothing.
      eventId: String(event?.id || obj.id || ''),
      invoiceNumber,
      amount,
      currency: String(obj.currency || 'usd'),
      method: paidMethod,
      sessionId: obj.id || null,
    });
    if (!applied.ok) {
      console.error('[stripe-webhook] ledger apply failed:', applied.status, applied.text);
      return new Response(JSON.stringify({ error: 'invoice update failed', status: applied.status, text: applied.text }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const verdict = applied.verdict || {};
    // A duplicate is a success. Returning 500 here would make Stripe retry an
    // event that has already been applied correctly, forever.
    if (verdict.applied === false && verdict.reason === 'duplicate_event') {
      console.log('[stripe-webhook] duplicate event ignored:', event?.id, invoiceNumber);
      return new Response(JSON.stringify({ ok: true, note: 'duplicate event, already applied' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Anything else the RPC declined is a real mismatch -- an unknown invoice, a
    // currency we do not settle, an amount larger than the invoice. Those are
    // NOT retryable and must be seen by a human rather than swallowed.
    if (verdict.applied === false) {
      console.error('[stripe-webhook] payment declined by ledger:', JSON.stringify(verdict));
      return new Response(JSON.stringify({ ok: false, declined: verdict }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log('[stripe-webhook] payment applied:', invoiceNumber, '$' + amount, 'status=' + verdict.status);
    // Fire-and-forget WhatsApp alert
    fetch(`${SUPABASE_URL}/functions/v1/notify-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        event: 'invoice_paid_stripe',
        secret: Deno.env.get('GL_NOTIFY_SECRET') || '',
        data: { invoice_number: invoiceNumber, amount: String(amount ?? ''), paid_method: paidMethod || 'card' },
      }),
    }).catch(e => console.warn('[stripe-webhook] notify-deal error:', e));
    return new Response(JSON.stringify({ ok: true, invoice: invoiceNumber, amount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // charge.refunded → reset invoice to overdue
  if (type === 'charge.refunded') {
    // Stripe Charge objects carry metadata directly (no payment_intent_data property)
    const invoiceNumber = (obj.metadata?.invoice_id || obj.metadata?.invoice_number || '').trim();
    if (invoiceNumber) {
      // Refunds go through the ledger for the same reason payments do: Stripe
      // redelivers this event, and the old PATCH re-applied on every delivery.
      // Its HTTP status was logged and never checked, so a refund the database
      // refused looked exactly like one it accepted.
      const refundAmount = typeof obj.amount_refunded === 'number' ? obj.amount_refunded / 100 : null;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gl_apply_refund_event`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_provider: 'stripe',
          p_event_id: String(event?.id || obj.id || ''),
          p_invoice_number: invoiceNumber,
          p_amount: refundAmount,
          p_reference: obj.id || null,
        }),
      });
      const refundText = await r.text();
      if (!r.ok) {
        console.error('[stripe-webhook] refund apply failed:', r.status, refundText);
        return new Response(JSON.stringify({ error: 'refund failed', status: r.status, text: refundText }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('[stripe-webhook] refund handled:', invoiceNumber, refundText);
    } else {
      console.warn('[stripe-webhook] charge.refunded: no invoice_number in charge metadata, skipping reset');
    }
    return new Response(JSON.stringify({ ok: true, type: 'refund' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Anything else: acknowledge so Stripe doesn't retry, but log it.
  return new Response(JSON.stringify({ ok: true, ignored: type }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
