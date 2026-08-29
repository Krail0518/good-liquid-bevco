// stripe-checkout-session — creates a Stripe Checkout Session for an invoice
// and returns the hosted-checkout URL. Supports an optional credit-card
// surcharge that's added as a separate line item so the customer sees
// the fee broken out on the Stripe receipt.
//
// Request body (POST JSON):
//   {
//     invoice_id:    string   // human-readable invoice number e.g. "GL-1042"
//     amount:        number   // IGNORED. The browser still sends it; the
//                             // charge is read from the invoices row instead.
//                             // Documenting it as an input was itself part of
//                             // why this function read as though it trusted a
//                             // client amount.
//     currency?:     string   // default "usd"
//     description?:  string   // appears on the Stripe checkout page
//     client_email?: string   // pre-fills email on the checkout page
//     success_url:   string   // where Stripe sends the user on success
//     cancel_url:    string   // where Stripe sends the user on cancel
//
//     payment_method?: 'card' | 'ach' | 'both'  // default 'both'
//     surcharge_pct?:  number                    // e.g. 3 (only applied if payment_method='card')
//   }
//
// Response:
//   { url, session_id, base_amount, surcharge_amount, total_amount }   on success
//   { error: string }                                                  on failure
//
// Secrets required:
//   STRIPE_SECRET_KEY    — sk_live_… or sk_test_…
//
// Deploy:
//   supabase functions deploy stripe-checkout-session
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
    share_token,
    // `amount` is deliberately NOT destructured. The browser still sends one
    // and it is ignored: the charge is built from dbAmount below, read from
    // the invoices row under the service-role key.
    //
    // It used to be pulled out here and then never used, which made the
    // function READ as though it trusted a client-supplied amount. An external
    // security review flagged exactly that on 2026-08-29 and asked for the
    // amount to be server-derived — it already was. Code that merely looks
    // unsafe still costs a review cycle and invites a "fix" that breaks it.
    currency = 'usd',
    description,
    client_email,
    success_url,
    cancel_url,
    payment_method = 'both',
    surcharge_pct = 0,
  } = payload as Record<string, string | number>;

  if (!success_url) return errorResponse('success_url is required', 400);
  if (!cancel_url)  return errorResponse('cancel_url is required', 400);

  /* ── AUTHORIZATION ──────────────────────────────────────────────────
     This function performs a SERVICE-ROLE invoice lookup, which bypasses
     RLS entirely. It previously did no caller check at all and addressed
     the row by `invoice_number` — a short, sequential, guessable string
     like "GL-1042". Anyone who could reach the endpoint could therefore
     walk the invoice-number space and learn, for every client:
       - whether an invoice exists            (404 vs 200)
       - whether it is paid or voided         (distinct 409 messages)
       - its exact amount                     (returned in the session)

     It stays reachable without a CRM login, because that is the point of
     a public pay link. But the caller must now prove they hold something
     they could not have guessed:

       (a) share_token — the unique token already used for the public
           invoice view. The lookup is BY THE TOKEN, so an invoice number
           is no longer an access key and cannot be enumerated at all.
       (b) a staff session — for the in-CRM "take payment" flow.

     requireStaff() rejects a bare anon/publishable key, which matters
     here: supabase-js functions.invoke() attaches the publishable key as
     the Authorization header when the customer has no session, so
     "an Authorization header is present" proves nothing on its own. */
  let lookupFilter = '';
  let authMode = '';

  if (share_token) {
    // Address the row by the unguessable token, never by the number.
    lookupFilter = `share_token=eq.${encodeURIComponent(String(share_token))}`;
    authMode = 'share_token';
  } else {
    const staff = await requireStaff(req);
    if (!staff.ok) {
      // Deliberately identical to the not-found response below, so this
      // cannot be used to probe which invoice numbers exist.
      return errorResponse('Invoice not found', 404);
    }
    if (!invoice_id) return errorResponse('invoice_id is required', 400);
    lookupFilter = `invoice_number=eq.${encodeURIComponent(String(invoice_id))}`;
    authMode = 'staff';
  }

  // ── Charge the invoice's REAL amount from the database — never the amount
  //    sent by the browser (a client could POST amount:0.01 to clear a $10k
  //    invoice).
  let dbAmount: number | null = null;
  let dbStatus = '';
  let dbNumber = '';
  try {
    const invRes = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?select=amount,status,invoice_number&${lookupFilter}&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const rows = await invRes.json();
    if (Array.isArray(rows) && rows.length) {
      dbAmount = Number(rows[0].amount);
      dbStatus = String(rows[0].status || '');
      dbNumber = String(rows[0].invoice_number || '');
    }
  } catch (e) {
    console.error('[stripe-checkout-session] invoice lookup failed', e);
    return errorResponse('Could not verify invoice', 502);
  }
  if (dbAmount == null || !(dbAmount > 0)) return errorResponse('Invoice not found', 404);

  // When both were supplied, they must describe the same invoice — otherwise a
  // valid token for one invoice could be paired with another's number.
  if (authMode === 'share_token' && invoice_id && dbNumber && String(invoice_id) !== dbNumber) {
    return errorResponse('Invoice not found', 404);
  }

  if (dbStatus === 'paid')   return errorResponse('This invoice is already paid', 409);
  if (dbStatus === 'voided') return errorResponse('This invoice has been voided', 409);
  const chargeAmount = dbAmount;

  const pm = String(payment_method).toLowerCase();
  if (pm !== 'card' && pm !== 'ach' && pm !== 'both') {
    return errorResponse(`payment_method must be 'card', 'ach', or 'both' (got "${pm}")`, 400);
  }

  // Surcharge only applies to card payments. Force 0 for ACH-only or both.
  const surchargePctNum = pm === 'card' ? Math.max(0, Number(surcharge_pct) || 0) : 0;
  // Compute fee in cents directly to avoid floating-point drift.
  // amount(dollars) * pct% → fee(cents) = round(amount * pct).
  const baseCents = Math.round(chargeAmount * 100);
  const feeCents  = surchargePctNum > 0 ? Math.round(chargeAmount * surchargePctNum) : 0;

  // Build the form-encoded body Stripe's REST API expects.
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', String(success_url));
  form.set('cancel_url',  String(cancel_url));
  form.set('client_reference_id', String(invoice_id));

  // Restrict payment methods to what the customer chose up front.
  if (pm === 'card') {
    form.set('payment_method_types[0]', 'card');
  } else if (pm === 'ach') {
    form.set('payment_method_types[0]', 'us_bank_account');
  } else {
    form.set('payment_method_types[0]', 'card');
    form.set('payment_method_types[1]', 'us_bank_account');
  }

  if (client_email) form.set('customer_email', String(client_email));

  // Line item 1: the invoice itself.
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]',           String(currency));
  form.set('line_items[0][price_data][unit_amount]',        String(baseCents));
  form.set('line_items[0][price_data][product_data][name]', `Invoice ${invoice_id}`);
  if (description) {
    form.set('line_items[0][price_data][product_data][description]', String(description));
  }

  // Line item 2: card processing surcharge (only if applicable).
  if (feeCents > 0) {
    form.set('line_items[1][quantity]', '1');
    form.set('line_items[1][price_data][currency]',           String(currency));
    form.set('line_items[1][price_data][unit_amount]',        String(feeCents));
    form.set('line_items[1][price_data][product_data][name]', `Credit card processing fee (${surchargePctNum}%)`);
    form.set('line_items[1][price_data][product_data][description]',
      `Surcharge for card payment on invoice ${invoice_id}. Pay by ACH bank transfer to avoid this fee.`);
  }

  // Metadata so the payment can be matched back to the invoice in webhooks / dashboard.
  form.set('metadata[invoice_id]',            String(invoice_id));
  form.set('metadata[payment_method_choice]', pm);
  form.set('metadata[surcharge_pct]',         String(surchargePctNum));
  form.set('metadata[base_amount_cents]',     String(baseCents));
  form.set('metadata[fee_amount_cents]',      String(feeCents));
  form.set('metadata[source]',                'goodliquid-crm');

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
  return jsonResponse({
    url: data.url,
    session_id: data.id,
    base_amount:     baseCents / 100,
    surcharge_amount: feeCents / 100,
    total_amount:    (baseCents + feeCents) / 100,
    payment_method:  pm,
    surcharge_pct:   surchargePctNum,
  });
});
