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

async function patchInvoice(invoiceNumber: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${SUPABASE_URL}/rest/v1/invoices?invoice_number=eq.${encodeURIComponent(invoiceNumber)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
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

    const patch = await patchInvoice(invoiceNumber, {
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_session_id: obj.id || null,
      paid_method: paidMethod,
      paid_amount: amount,
    });
    if (!patch.ok) {
      console.error('[stripe-webhook] PATCH invoice failed:', patch.status, patch.text);
      return new Response(JSON.stringify({ error: 'invoice update failed', status: patch.status, text: patch.text }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log('[stripe-webhook] marked invoice paid:', invoiceNumber, '$' + amount);
    return new Response(JSON.stringify({ ok: true, invoice: invoiceNumber, amount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // charge.refunded → optional: mark refunded
  if (type === 'charge.refunded') {
    const sessionId = (obj.payment_intent && obj.payment_intent_data?.metadata?.session_id) || null;
    // Best-effort: look up by stripe_session_id and reset to overdue.
    // Skip the lookup if we don't have a session_id reference.
    if (sessionId) {
      const url = `${SUPABASE_URL}/rest/v1/invoices?stripe_session_id=eq.${encodeURIComponent(sessionId)}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'overdue', paid_at: null, paid_amount: null }),
      });
      console.log('[stripe-webhook] refund handled, PATCH status:', r.status);
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
