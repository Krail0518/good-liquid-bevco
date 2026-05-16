// qbo-callback — Intuit redirects here after the user grants access.
// Exchanges the auth code for access + refresh tokens, stores them in the
// qbo_tokens table, and returns a tiny HTML page that posts a message
// back to the opener window then closes itself.
//
// Query string (set by Intuit):
//   ?code=...&state=...&realmId=...
//
// Secrets required:
//   INTUIT_CLIENT_ID
//   INTUIT_CLIENT_SECRET
//   INTUIT_REDIRECT_URI       — must match what was sent to qbo-connect
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected (needed to write tokens)

import { errorResponse } from '../_shared/cors.ts';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer_authorization';

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const code    = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state   = url.searchParams.get('state') || '';

  if (!code || !realmId) {
    return errorResponse('Missing code or realmId in callback', 400);
  }

  const clientId     = Deno.env.get('INTUIT_CLIENT_ID');
  const clientSecret = Deno.env.get('INTUIT_CLIENT_SECRET');
  const redirectUri  = Deno.env.get('INTUIT_REDIRECT_URI');
  const supaUrl      = Deno.env.get('SUPABASE_URL');
  const supaSrvKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!clientId || !clientSecret || !redirectUri || !supaUrl || !supaSrvKey) {
    return errorResponse('Missing required env vars', 500);
  }

  // Exchange code for tokens.
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);

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
    const errText = await r.text();
    console.error('[qbo-callback] token exchange failed:', r.status, errText);
    return errorResponse('Intuit rejected the token exchange', r.status, { intuit_error: errText });
  }

  const data = await r.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + (data.expires_in * 1000)).toISOString();

  // Persist to the single-row qbo_tokens table via the service role key.
  const upsert = await fetch(`${supaUrl}/rest/v1/qbo_tokens`, {
    method: 'POST',
    headers: {
      'apikey': supaSrvKey,
      'Authorization': `Bearer ${supaSrvKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: 1,
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      realm_id:      realmId,
      expires_at:    expiresAt,
      updated_at:    new Date().toISOString(),
    }),
  });

  if (!upsert.ok) {
    const errText = await upsert.text();
    console.error('[qbo-callback] token persist failed:', upsert.status, errText);
    return errorResponse('Could not save tokens', 500, { db_error: errText });
  }

  // Return an HTML page that posts back to the opener and self-closes.
  // The CRM listens for "qbo_connected" via window.addEventListener('message').
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connected</title>
<style>body{font-family:-apple-system,sans-serif;background:#0a1628;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.box{padding:30px;border:1px solid rgba(0,229,192,.3);border-radius:14px;background:#142238;max-width:400px}
h1{font-size:18px;letter-spacing:2px;color:#00e5c0;margin:0 0 12px}
p{font-size:13px;color:#9aa7bd;line-height:1.6}</style>
</head><body>
<div class="box">
  <h1>✓ QUICKBOOKS CONNECTED</h1>
  <p>Realm <code>${realmId}</code> linked successfully.<br>This window will close in a moment.</p>
</div>
<script>
try { if (window.opener) window.opener.postMessage('qbo_connected', '*'); } catch(e){}
setTimeout(function(){ try { window.close(); } catch(e){} }, 1500);
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});
