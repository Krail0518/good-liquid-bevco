// gmail-send — sends email via Gmail API using OAuth2 refresh token.
// Drop-in replacement for mailgun-send for notification emails.
//
// Request body (POST JSON):
//   {
//     to:       string | string[]   required
//     subject:  string              required
//     text:     string              required (plain-text body)
//     html?:    string              optional HTML alternative
//     from?:    string              optional override; defaults to GMAIL_FROM
//     replyTo?: string              optional Reply-To header
//   }
//
// Response:
//   { ok: true, id }      on success
//   { ok: false, error }  on failure
//
// Secrets required:
//   GMAIL_CLIENT_ID      — OAuth2 Web application client ID
//   GMAIL_CLIENT_SECRET  — OAuth2 Web application client secret
//   GMAIL_REFRESH_TOKEN  — long-lived refresh token from OAuth Playground
//   GMAIL_FROM           — default From, e.g. "Good Liquid Bev Co <mike@goodliquid.com>"
//
// Deploy:
//   supabase functions deploy gmail-send

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

async function getAccessToken(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GMAIL_CLIENT_ID')!,
      client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GMAIL_REFRESH_TOKEN')!,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`token refresh failed ${r.status}: ${t}`);
  }
  const d = await r.json();
  return d.access_token as string;
}

function buildMime(
  from: string, to: string[], subject: string,
  text: string, html?: string, replyTo?: string,
): string {
  const lines: string[] = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);

  if (html) {
    const boundary = 'gl_boundary_' + Date.now();
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('');
    lines.push(text);
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('');
    lines.push(html);
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('');
    lines.push(text);
  }
  return lines.join('\r\n');
}

function toBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function normalizeList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return (v as unknown[]).filter(Boolean).map(String);
  return String(v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  if (!Deno.env.get('GMAIL_CLIENT_ID') || !Deno.env.get('GMAIL_REFRESH_TOKEN')) {
    return errorResponse('Gmail OAuth credentials not configured', 500);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const to = normalizeList(payload.to);
  if (!to.length) return errorResponse('`to` required', 400);
  const subject = String(payload.subject || '').trim();
  if (!subject) return errorResponse('`subject` required', 400);
  const text = String(payload.text || '');
  if (!text) return errorResponse('`text` required', 400);
  const from = String(payload.from || Deno.env.get('GMAIL_FROM') || '');
  if (!from) return errorResponse('GMAIL_FROM not configured', 500);
  const html    = payload.html    ? String(payload.html)    : undefined;
  const replyTo = payload.replyTo ? String(payload.replyTo) : undefined;

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error('[gmail-send] token error:', e);
    return errorResponse('Token error: ' + String(e), 500);
  }

  const raw = toBase64url(buildMime(from, to, subject, text, html, replyTo));

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '<no body>');
    console.error('[gmail-send] Gmail API error:', r.status, errText);
    return errorResponse('Gmail API error: ' + errText, r.status);
  }
  const data = await r.json().catch(() => ({}));
  console.log('[gmail-send] sent ok, id:', data.id);
  return jsonResponse({ ok: true, id: data.id || null });
});
