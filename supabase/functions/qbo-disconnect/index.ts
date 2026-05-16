// qbo-disconnect — revokes the Intuit refresh token and clears the stored
// row in qbo_tokens. After this the CRM falls back to "not connected".
//
// Secrets required:
//   INTUIT_CLIENT_ID
//   INTUIT_CLIENT_SECRET
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const clientId     = Deno.env.get('INTUIT_CLIENT_ID');
  const clientSecret = Deno.env.get('INTUIT_CLIENT_SECRET');
  const supaUrl      = Deno.env.get('SUPABASE_URL');
  const supaSrvKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!clientId || !clientSecret || !supaUrl || !supaSrvKey) {
    return errorResponse('Missing required env vars', 500);
  }

  // Load the existing refresh token.
  const fetchRow = await fetch(`${supaUrl}/rest/v1/qbo_tokens?id=eq.1&select=refresh_token`, {
    headers: { 'apikey': supaSrvKey, 'Authorization': `Bearer ${supaSrvKey}` },
  });
  const rows = await fetchRow.json();
  const refreshToken = rows?.[0]?.refresh_token;

  if (refreshToken) {
    // Best-effort revoke at Intuit.
    const auth = btoa(`${clientId}:${clientSecret}`);
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ token: refreshToken }),
      });
    } catch (e) {
      console.warn('[qbo-disconnect] revoke call failed (continuing):', e);
    }
  }

  // Always clear our side regardless of revoke outcome.
  await fetch(`${supaUrl}/rest/v1/qbo_tokens?id=eq.1`, {
    method: 'DELETE',
    headers: { 'apikey': supaSrvKey, 'Authorization': `Bearer ${supaSrvKey}` },
  });

  return jsonResponse({ ok: true });
});
