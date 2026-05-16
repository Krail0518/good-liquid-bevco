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

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

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

  // CSRF state — opaque random + the caller origin so the callback can verify.
  const state = crypto.randomUUID() + '.' + btoa(origin || '').replace(/=/g, '');
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
