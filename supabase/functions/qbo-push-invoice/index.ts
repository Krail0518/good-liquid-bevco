// qbo-push-invoice — pushes a Good Liquid invoice into QuickBooks Online.
// Handles two responsibilities the client can't:
//   1. Refresh the Intuit access token if it's expired (or close to it)
//   2. Find-or-create the QB Customer for the invoice's client
//   3. POST the QB Invoice with proper line items and CustomerRef
//
// Request body (POST JSON):
//   {
//     invoice_id:  string
//     amount:      number
//     issued_at:   string  (YYYY-MM-DD)
//     due_at?:     string  (YYYY-MM-DD)
//     status?:     string
//     notes?:      string
//     customer: { name: string, email?: string, company?: string }
//     lines: [
//       { description: string, qty: number, unit_price: number, total: number, category?: string }
//     ]
//   }
//
// Response:
//   { ok:true, qbo_invoice_id: string }
//   { error: string }
//
// Secrets required:
//   INTUIT_CLIENT_ID
//   INTUIT_CLIENT_SECRET
//   INTUIT_ENV               — "sandbox" or "production" (default "sandbox")
//   SUPABASE_URL             — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer_authorization';

function qboBase(env: string): string {
  return env === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

interface QboTokenRow {
  access_token:  string;
  refresh_token: string;
  realm_id:      string;
  expires_at:    string;
}

async function loadTokens(supaUrl: string, key: string): Promise<QboTokenRow | null> {
  const r = await fetch(`${supaUrl}/rest/v1/qbo_tokens?id=eq.1&select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
  });
  const rows = await r.json();
  return rows?.[0] || null;
}

async function saveTokens(supaUrl: string, key: string, t: QboTokenRow): Promise<void> {
  await fetch(`${supaUrl}/rest/v1/qbo_tokens`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: 1, ...t, updated_at: new Date().toISOString() }),
  });
}

async function refreshIfNeeded(tokens: QboTokenRow, clientId: string, clientSecret: string): Promise<QboTokenRow> {
  // Refresh if the token expires within 5 minutes (or already expired).
  const expiresAt = Date.parse(tokens.expires_at);
  if (expiresAt - Date.now() > 5 * 60_000) return tokens;

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', tokens.refresh_token);
  const auth = btoa(`${clientId}:${clientSecret}`);

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });
  if (!r.ok) {
    throw new Error(`Token refresh failed: ${r.status} ${await r.text()}`);
  }
  const data = await r.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    realm_id:      tokens.realm_id,
    expires_at:    new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

async function findOrCreateCustomer(env: string, accessToken: string, realmId: string, customer: { name: string; email?: string; company?: string }): Promise<string> {
  const base = qboBase(env);
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  // Try to find an existing customer by display name.
  const safe = customer.name.replace(/'/g, "\\'");
  const queryUrl = `${base}/v3/company/${realmId}/query?query=` +
    encodeURIComponent(`select * from Customer where DisplayName = '${safe}'`);
  const find = await fetch(queryUrl, { headers });
  if (find.ok) {
    const j = await find.json();
    const existing = j?.QueryResponse?.Customer?.[0];
    if (existing?.Id) return existing.Id;
  }

  // Create one.
  const create = await fetch(`${base}/v3/company/${realmId}/customer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      DisplayName:    customer.name,
      CompanyName:    customer.company || customer.name,
      PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
    }),
  });
  if (!create.ok) {
    throw new Error(`Customer create failed: ${create.status} ${await create.text()}`);
  }
  const j = await create.json();
  return j?.Customer?.Id;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const clientId     = Deno.env.get('INTUIT_CLIENT_ID');
  const clientSecret = Deno.env.get('INTUIT_CLIENT_SECRET');
  const intuitEnv    = Deno.env.get('INTUIT_ENV') || 'sandbox';
  const supaUrl      = Deno.env.get('SUPABASE_URL');
  const supaSrvKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!clientId || !clientSecret || !supaUrl || !supaSrvKey) {
    return errorResponse('Missing required env vars', 500);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const invoiceId = String(payload.invoice_id || '');
  const issuedAt  = String(payload.issued_at  || new Date().toISOString().slice(0,10));
  const dueAt     = payload.due_at ? String(payload.due_at) : undefined;
  const notes     = String(payload.notes || '');
  const customer  = payload.customer as { name: string; email?: string; company?: string };
  const lines     = (payload.lines as Array<{ description: string; qty: number; unit_price: number; total: number }>) || [];

  if (!invoiceId)         return errorResponse('invoice_id is required', 400);
  if (!customer?.name)    return errorResponse('customer.name is required', 400);
  if (!lines.length)      return errorResponse('lines must have at least one entry', 400);

  // Load + refresh tokens.
  let tokens = await loadTokens(supaUrl, supaSrvKey);
  if (!tokens) return errorResponse('QuickBooks not connected. Connect from CRM first.', 412);
  try {
    const refreshed = await refreshIfNeeded(tokens, clientId, clientSecret);
    if (refreshed.access_token !== tokens.access_token) {
      tokens = refreshed;
      await saveTokens(supaUrl, supaSrvKey, tokens);
    }
  } catch (e) {
    console.error('[qbo-push-invoice] refresh failed:', e);
    return errorResponse('Could not refresh QuickBooks token — reconnect from CRM.', 401);
  }

  // Find or create the customer.
  let customerId: string;
  try {
    customerId = await findOrCreateCustomer(intuitEnv, tokens.access_token, tokens.realm_id, customer);
  } catch (e) {
    console.error('[qbo-push-invoice] customer step failed:', e);
    return errorResponse('Could not find or create QuickBooks customer', 502, { detail: String(e) });
  }

  // Build the QB Invoice payload.
  const qbLines = lines.map((l, i) => ({
    Id: String(i + 1),
    LineNum: i + 1,
    Amount: Number(l.total || (l.qty * l.unit_price) || 0),
    DetailType: 'SalesItemLineDetail',
    Description: l.description || '',
    SalesItemLineDetail: {
      // Default ItemRef id "1" usually maps to QB's "Services" item. The user
      // can re-categorize lines in QuickBooks after the push.
      ItemRef: { value: '1', name: 'Services' },
      Qty: Number(l.qty || 1),
      UnitPrice: Number(l.unit_price || 0),
    },
  }));

  const invoiceBody = {
    DocNumber: invoiceId,
    TxnDate: issuedAt,
    DueDate: dueAt,
    CustomerRef: { value: customerId },
    Line: qbLines,
    CustomerMemo: notes ? { value: notes } : undefined,
  };

  const base = qboBase(intuitEnv);
  const r = await fetch(`${base}/v3/company/${tokens.realm_id}/invoice`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(invoiceBody),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('[qbo-push-invoice] invoice create failed:', r.status, errText);
    return errorResponse('QuickBooks rejected the invoice', r.status, { qbo_error: errText });
  }

  const j = await r.json();
  return jsonResponse({
    ok: true,
    qbo_invoice_id: j?.Invoice?.Id,
    qbo_customer_id: customerId,
  });
});
