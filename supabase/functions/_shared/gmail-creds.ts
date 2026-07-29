// Single source of truth for the Gmail OAuth credential set.
//
// Two places can hold the credentials:
//   1. Supabase Vault (gl_gmail_client_id / _client_secret / _refresh_token) —
//      written by the in-app "Connect Gmail" flow (the gmail-oauth function).
//   2. Env secrets GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN —
//      the original hand-configured path.
//
// A COMPLETE Vault set wins; otherwise the complete env set is used. The sets
// are never mixed: pairing an old client id with a new secret (or a token
// minted under a different client) is precisely the failure mode that took
// Gmail sending down for a day.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface GmailCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  source: 'vault' | 'env';
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// Vault access goes through gl_secret_get / gl_secret_set — security-definer
// RPCs executable only by service_role, so browsers can never touch them.
export async function vaultGet(name: string): Promise<string> {
  try {
    const { data } = await admin().rpc('gl_secret_get', { p_name: name });
    return (typeof data === 'string') ? data : '';
  } catch {
    return '';
  }
}

export async function vaultSet(name: string, value: string): Promise<void> {
  const { error } = await admin().rpc('gl_secret_set', { p_name: name, p_value: value });
  if (error) throw new Error('vault write failed: ' + error.message);
  _cache = null; // a write invalidates the resolved-credentials cache
}

// Short-lived module cache: gmail-send/gmail-sync each resolve creds twice per
// request (configured-check + token fetch) and every resolve costs three Vault
// RPCs. Positive results cache 30s, misses only 3s so a just-completed connect
// isn't masked for long. Isolates are short-lived, so staleness is bounded.
let _cache: { creds: GmailCreds | null; at: number } | null = null;

export async function getGmailCreds(): Promise<GmailCreds | null> {
  const now = Date.now();
  if (_cache && (now - _cache.at) < (_cache.creds ? 30000 : 3000)) return _cache.creds;
  let resolved: GmailCreds | null = null;
  const [id, secret, refresh] = await Promise.all([
    vaultGet('gl_gmail_client_id'),
    vaultGet('gl_gmail_client_secret'),
    vaultGet('gl_gmail_refresh_token'),
  ]);
  if (id && secret && refresh) {
    resolved = { clientId: id, clientSecret: secret, refreshToken: refresh, source: 'vault' };
  } else if (id && secret) {
    // Keys saved in Vault but Connect not completed yet. Deliberately do NOT
    // fall back to env: saving new keys means the old credential set is dead,
    // and testing/sending with it surfaced the OLD set's invalid_client as if
    // the freshly saved keys were bad — which misled a real debugging session.
    resolved = null;
  } else {
    const eId = Deno.env.get('GMAIL_CLIENT_ID') || '';
    const eSecret = Deno.env.get('GMAIL_CLIENT_SECRET') || '';
    const eRefresh = Deno.env.get('GMAIL_REFRESH_TOKEN') || '';
    if (eId && eSecret && eRefresh) {
      resolved = { clientId: eId, clientSecret: eSecret, refreshToken: eRefresh, source: 'env' };
    }
  }
  _cache = { creds: resolved, at: now };
  return resolved;
}

// True when the Vault holds a saved key pair that has not completed Connect —
// the "one click left" state the UI should name precisely.
export async function gmailPendingConnect(): Promise<boolean> {
  const [id, secret, refresh] = await Promise.all([
    vaultGet('gl_gmail_client_id'),
    vaultGet('gl_gmail_client_secret'),
    vaultGet('gl_gmail_refresh_token'),
  ]);
  return !!(id && secret && !refresh);
}

export async function gmailConfigured(): Promise<boolean> {
  return (await getGmailCreds()) !== null;
}

// Exchange the refresh token for an access token. Throws with the raw Google
// error body so callers can surface e.g. invalid_client precisely.
export async function getGmailAccessToken(): Promise<string> {
  const creds = await getGmailCreds();
  if (!creds) throw new Error('Gmail is not connected (no credentials in Vault or env)');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`token refresh failed ${r.status} (${creds.source} creds): ${t}`);
  }
  return (await r.json()).access_token as string;
}
