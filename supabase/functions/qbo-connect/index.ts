// qbo-connect — kicks off the Intuit OAuth2 flow.
// Returns the Intuit authorize URL. The browser pops this in a new window;
// after the user grants access, Intuit redirects to qbo-callback.
//
// Request body (POST JSON):
//   { origin?: string }   // optional — included in state for CSRF protection
//
// Response:
//   { auth_url: string, state: string }
//
// Secrets required:
//   INTUIT_CLIENT_ID        — from Intuit developer console
//   INTUIT_REDIRECT_URI     — full URL of the qbo-callback function
//                              e.g. https://<ref>.supabase.co/functions/v1/qbo-callback
//   INTUIT_ENV              — "sandbox" or "production" (default "sandbox")

import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  // Connecting QuickBooks binds the whole org's accounting integration, so
  // only staff may start the flow. The browser already sends its session
  // token here (crm-integrations.js authHeader()).
  const staff = await requireStaff(req);
  if (!staff.ok) return errorResponse(staff.error || 'Unauthorized', staff.status || 401);

  const clientId    = Deno.env.get('INTUIT_CLIENT_ID');
  const redirectUri = Deno.env.get('INTUIT_REDIRECT_URI');
  if (!clientId || !redirectUri) {
    return errorResponse('INTUIT_CLIENT_ID and INTUIT_REDIRECT_URI must be set', 500);
  }

  let origin = '';
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      origin = String(body?.origin || '');
    } catch { /* origin stays blank */ }
  }

  /* CSRF state. Previously this value was generated, handed to Intuit, echoed
     back to qbo-callback, and dropped — the callback verified nothing, so the
     comment that used to sit here described protection that did not exist.
     It is now persisted server-side so the callback can check it, and consumed
     there on first use. */
  const state = crypto.randomUUID() + '.' + btoa(origin || '').replace(/=/g, '');

  // Opportunistic housekeeping so abandoned connect attempts do not accumulate.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/gl_purge_expired_qbo_states`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch { /* non-fatal */ }

  // Record the pending state. If this write fails the flow must NOT continue:
  // the callback would then reject the state and the user would see a confusing
  // failure after granting access at Intuit. Better to fail before the popup.
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/qbo_oauth_states`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ state, origin: origin || null, created_by: staff.userId || null }),
  });
  if (!ins.ok) {
    const t = await ins.text();
    console.error('[qbo-connect] could not persist OAuth state:', ins.status, t);
    return errorResponse('Could not start the QuickBooks connection — please try again', 500);
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    redirect_uri:  redirectUri,
    state,
  });

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
  return jsonResponse({ auth_url: authUrl, state });
});
