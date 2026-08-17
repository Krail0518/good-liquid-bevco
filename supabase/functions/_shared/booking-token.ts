// booking-token — capability tokens for the tour approve/decline links.
//
// A tour request now waits for Mike to approve it. The approval link is sent to
// him over WhatsApp/email and carries no login, so the link itself must be the
// credential: only someone holding a valid token for a booking may approve or
// decline it. We HMAC the booking id with a server-only secret; the token is
// unforgeable without the secret and reveals nothing about it.
//
// The same secret must sign (booking-confirm) and verify (booking-approve), so
// both import from here. We reuse the shared gl_notify_secret. CRITICAL: read it
// from Vault FIRST, falling back to the env var — matching notify-deal,
// lead-automations and estimate-deal-value. The rotation migration
// (20260730002000_rotate_notify_secret.sql) moved the canonical secret into Vault
// precisely because the old env value once shipped publicly in page source; an
// env-only read here would sign/verify with that leaked value, letting anyone
// holding it forge valid approve/decline links. No service-role fallback: a
// missing secret must fail loudly, not silently sign with an unrelated key.

import { vaultGet } from './gmail-creds.ts';

async function secret(): Promise<string> {
  const s = (await vaultGet('gl_notify_secret')) || Deno.env.get('GL_NOTIFY_SECRET') || '';
  if (!s) throw new Error('No signing secret available (gl_notify_secret / GL_NOTIFY_SECRET unset)');
  return s;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256(bookingId) as lowercase hex.
export async function signBooking(bookingId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(await secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(bookingId)));
  return toHex(sig);
}

// Constant-time-ish comparison so a token can't be probed byte by byte.
export async function verifyBooking(bookingId: string, token: string): Promise<boolean> {
  if (!bookingId || !token) return false;
  const expected = await signBooking(bookingId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
