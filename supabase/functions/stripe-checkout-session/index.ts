// stripe-checkout-session — creates a Stripe Checkout Session for an invoice
// and returns the hosted-checkout URL. The browser is told to redirect there
// so the customer can pay with card / ACH / Apple Pay / etc.
//
// Request body (POST JSON):
//   {
//     invoice_id:   string   // human-readable invoice number e.g. "GL-1042"
//     amount:       number   // dollars, e.g. 1842.50
//     currency?:    string   // default "usd"
//     description?: string   // appears on the Stripe checkout page
//     client_email?: string  // pre-fills email on the checkout page
//     success_url:  string   // where Stripe sends the user on success
//     cancel_url:   string   // where Stripe sends the user on cancel
//   }
//
// Response:
//   { url: string, session_id: string }   on success
//   { error: string }                     on failure
//
// Secrets required:
//   STRIPE_SECRET_KEY    — sk_live_… or sk_test_…
//
// Deploy:
//   supabase functions deploy stripe-checkout-session
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    return errorResponse('STRIPE_SECRET_KEY not configured', 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const {
    invoice_id,
    amount,
    currency = 'usd',
    description,
    client_email,
    success_url,
    cancel_url,
  } = payload as Record<string, string | number>;

  if (!invoice_id) return errorResponse('invoice_id is required', 400);
  if (typeof amount !== 'number' || amount <= 0) return errorResponse('amount must be a positive number', 400);
  if (!success_url) return errorResponse('success_url is required', 400);
  if (!cancel_url)  return errorResponse('cancel_url is required', 400);

  // Stripe expects amount in the smallest currency unit (cents for USD).
  const unitAmount = Math.round((amount as number) * 100);

  // Build the form-encoded body Stripe's REST API expects.
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', String(success_url));
  form.set('cancel_url',  String(cancel_url));
  form.set('client_reference_id', String(invoice_id));
  form.set('payment_method_types[0]', 'card');
  if (client_email) form.set('customer_email', String(client_email));
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]',           String(currency));
  form.set('line_items[0][price_data][unit_amount]',        String(unitAmount));
  form.set('line_items[0][price_data][product_data][name]', `Invoice ${invoice_id}`);
  if (description) {
    form.set('line_items[0][price_data][product_data][description]', String(description));
  }
  // Metadata so we can match the Stripe payment back to the invoice later.
  form.set('metadata[invoice_id]', String(invoice_id));
  form.set('metadata[source]', 'goodliquid-crm');

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('[stripe-checkout-session] Stripe error:', r.status, errText);
    return errorResponse('Stripe rejected the request', r.status, { stripe_error: errText });
  }

  const data = await r.json();
  return jsonResponse({ url: data.url, session_id: data.id });
});
