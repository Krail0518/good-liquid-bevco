// gmail-oauth — connect the CRM to Gmail from inside the app.
//
// WHY THIS EXISTS
// Connecting Gmail used to require Google's OAuth Playground: copy the client
// id/secret between three tabs, run an "Exchange" step, then paste a refresh
// token into Supabase secrets by hand. Every hop was a chance to mismatch the
// pair — and one did, taking Gmail sending down for a day. This function
// replaces all of it: an admin pastes the Client ID + Secret ONCE into the
// CRM's own admin panel, clicks "Connect Gmail", signs in on Google, and the
// refresh token lands directly in Supabase Vault. Nothing transits a
// clipboard, and the pair can never drift apart because the callback always
// writes id + secret + token together.
//
// ACTIONS (POST JSON { action, ... } — every action requires an admin caller):
//   save     { client_id, client_secret }  store the OAuth client pair in Vault
//   status   {}                            which pieces exist + connected address
//   test     {}                            live refresh-token exchange, friendly errors
//   start    { redirect_uri }              → { url } Google consent URL to open
//   callback { code, redirect_uri }        exchange the returned code, store the
//                                          refresh token, remember the mailbox
//
// Which credential set gmail-send / gmail-sync actually use resolves in
// _shared/gmail-creds.ts: a complete Vault set wins, else the legacy env set.
//
// Deploy: supabase functions deploy gmail-oauth

import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
import { vaultGet, vaultSet, getGmailCreds, gmailPendingConnect } from '../_shared/gmail-creds.ts';
import { friendlyOAuthError } from '../_shared/oauth-errors.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
// Send + read: gmail-send needs the first, gmail-sync the second. Requested
// together so one consent covers both — a send-only token made sync 403.
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

async function clientPair(): Promise<{ id: string; secret: string } | null> {
  const [vId, vSec] = await Promise.all([
    vaultGet('gl_gmail_client_id'),
    vaultGet('gl_gmail_client_secret'),
  ]);
  if (vId && vSec) return { id: vId, secret: vSec };
  const eId = Deno.env.get('GMAIL_CLIENT_ID') || '';
  const eSec = Deno.env.get('GMAIL_CLIENT_SECRET') || '';
  if (eId && eSec) return { id: eId, secret: eSec };
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Staff-level, deliberately not role:'admin': the owner's founding profile
  // predates the role column (role is NULL), the login screen defaults a
  // missing role to 'admin' while requireStaff defaults it to 'sales', and
  // the mismatch locked the owner out of this panel. Staff-level matches
  // every other mail function (gmail-send, gmail-sync), and the panel itself
  // only renders for admins.
  const auth = await requireStaff(req);
  if (!auth.ok) return errorResponse(auth.error || 'Forbidden', auth.status);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }
  const action = String(body.action || '');

  if (action === 'save') {
    const id = String(body.client_id || '').trim();
    const secret = String(body.client_secret || '').trim();
    if (!id.endsWith('.apps.googleusercontent.com')) {
      return jsonResponse({ ok: false, error: 'That does not look like a Client ID — it should end in .apps.googleusercontent.com. Both values are on the OAuth client page in Google Console.' });
    }
    if (!secret) return jsonResponse({ ok: false, error: 'The Client Secret is empty.' });
    // A different client invalidates any refresh token minted under the old
    // one. Clear the token BEFORE the new keys land: if a write fails midway
    // we're left cleanly disconnected, never with new keys + a stale token —
    // the mixed-pair state that broke sending before.
    const prevId = await vaultGet('gl_gmail_client_id');
    if (prevId && prevId !== id) {
      await vaultSet('gl_gmail_refresh_token', '');
      await vaultSet('gl_gmail_connected_email', '');
    }
    await vaultSet('gl_gmail_client_id', id);
    await vaultSet('gl_gmail_client_secret', secret);
    return jsonResponse({ ok: true });
  }

  if (action === 'status') {
    const [vId, vSec, vRef, email] = await Promise.all([
      vaultGet('gl_gmail_client_id'),
      vaultGet('gl_gmail_client_secret'),
      vaultGet('gl_gmail_refresh_token'),
      vaultGet('gl_gmail_connected_email'),
    ]);
    const creds = await getGmailCreds();
    return jsonResponse({
      ok: true,
      has_client_id: !!(vId || Deno.env.get('GMAIL_CLIENT_ID')),
      has_client_secret: !!(vSec || Deno.env.get('GMAIL_CLIENT_SECRET')),
      has_refresh_token: !!(vRef || Deno.env.get('GMAIL_REFRESH_TOKEN')),
      // Saved keys awaiting Connect override any legacy env set — see
      // getGmailCreds for why the env fallback is dead once keys are saved.
      pending_connect: !!(vId && vSec && !vRef),
      connected: creds !== null,
      source: creds ? creds.source : null,
      email: email || null,
    });
  }

  if (action === 'test') {
    // Saved-but-not-connected must be named precisely: the old behavior fell
    // back to testing the dead env credentials and reported THEIR failure as
    // if the freshly saved keys were bad, which derailed a real debugging
    // session. There is nothing to test until Connect has minted a token.
    if (await gmailPendingConnect()) {
      return jsonResponse({ ok: false, pending: true, error: 'Keys are saved — but Gmail is not connected yet. Click "🔗 Connect Gmail" (there is nothing to test until then).' });
    }
    const creds = await getGmailCreds();
    if (!creds) return jsonResponse({ ok: false, error: 'Nothing to test yet — save the keys and connect first.' });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    if (r.ok) return jsonResponse({ ok: true, source: creds.source });
    const t = await r.text().catch(() => '');
    const fe = friendlyOAuthError(r.status, t);
    return jsonResponse({ ok: false, error: fe.friendly, code: fe.code, detail: fe.detail, source: creds.source });
  }

  if (action === 'start') {
    const redirect = String(body.redirect_uri || '').trim();
    if (!redirect.startsWith('https://')) return errorResponse('redirect_uri must be https', 400);
    // CSRF nonce: minted by the browser, held in its sessionStorage, echoed
    // back by Google via `state`, and compared on return. A constant state
    // would let an attacker-crafted URL bind a foreign mailbox to the CRM.
    const state = String(body.state || '').trim();
    if (!/^glgmail\.[A-Za-z0-9._-]{8,80}$/.test(state)) {
      return errorResponse('invalid state nonce', 400);
    }
    const pair = await clientPair();
    if (!pair) return jsonResponse({ ok: false, error: 'No OAuth client saved yet — paste the Client ID and Secret and Save first.' });
    const url = AUTH_URL + '?' + new URLSearchParams({
      client_id: pair.id,
      redirect_uri: redirect,
      response_type: 'code',
      access_type: 'offline',  // ask for a refresh token…
      prompt: 'consent',       // …every time, or Google omits it on re-grants
      scope: SCOPES,
      state,
    }).toString();
    return jsonResponse({ ok: true, url });
  }

  if (action === 'callback') {
    const code = String(body.code || '').trim();
    const redirect = String(body.redirect_uri || '').trim();
    if (!code || !redirect) return errorResponse('code and redirect_uri required', 400);
    const pair = await clientPair();
    if (!pair) return jsonResponse({ ok: false, error: 'No OAuth client saved — save the keys, then connect again.' });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     pair.id,
        client_secret: pair.secret,
        code,
        grant_type:   'authorization_code',
        redirect_uri: redirect,
      }),
    });
    const text = await r.text().catch(() => '');
    if (!r.ok) {
      const fe = friendlyOAuthError(r.status, text);
      console.error('[gmail-oauth] exchange failed:', fe.detail);
      return jsonResponse({ ok: false, error: fe.friendly, code: fe.code, detail: fe.detail });
    }
    let tok: Record<string, unknown> = {};
    try { tok = JSON.parse(text); } catch { /* handled below via !refresh */ }
    const refresh = String(tok.refresh_token || '');
    const access  = String(tok.access_token || '');
    if (!refresh) {
      return jsonResponse({ ok: false, error: "Google did not return a refresh token. Remove the app's old grant at myaccount.google.com/permissions, then click Connect Gmail again." });
    }
    // Store the COMPLETE set — id + secret + token always written together,
    // so the pair can never drift apart again.
    await vaultSet('gl_gmail_client_id', pair.id);
    await vaultSet('gl_gmail_client_secret', pair.secret);
    await vaultSet('gl_gmail_refresh_token', refresh);
    let email = '';
    try {
      const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (p.ok) email = String((await p.json()).emailAddress || '');
    } catch { /* cosmetic only — the connection itself already succeeded */ }
    await vaultSet('gl_gmail_connected_email', email);
    console.log('[gmail-oauth] connected', email || '(unknown mailbox)');
    return jsonResponse({ ok: true, email: email || null });
  }

  return errorResponse('Unknown action', 400);
});
