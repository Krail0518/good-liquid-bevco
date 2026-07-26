// gmail-send — sends email via Gmail API using OAuth2 refresh token.
// Sends internal notification emails for the Good Liquid CRM.
//
// Request body (POST JSON):
//   {
//     to:       string | string[]   required
//     subject:  string              required
//     text:     string              required (plain-text body)
//     html?:    string              optional HTML alternative
//     from?:    string              optional override; defaults to GMAIL_FROM
//     replyTo?: string              optional Reply-To header
//     cc?:      string | string[]   optional
//     bcc?:     string | string[]   optional
//     attachments?: { filename, contentBase64, contentType? }[]   optional
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
import { requireStaff } from '../_shared/auth.ts';

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

interface Attachment { filename: string; contentBase64: string; contentType?: string }

// Email headers must be plain ASCII. Any non-ASCII text (em-dash "—",
// accented customer names like "Café", emoji, etc.) has to be wrapped in an
// RFC 2047 "encoded-word" or the mail client mis-decodes the raw UTF-8 bytes
// and shows mojibake (e.g. "—" rendered as "Ã¢Â€Â"). Without this, subjects
// and display names built anywhere in the app arrive garbled.
function isAscii(s: string): boolean { return /^[\x00-\x7F]*$/.test(s); }

// Encode a header VALUE (e.g. a Subject) as one or more base64 encoded-words.
// We accumulate whole UTF-8 characters so a multi-byte char is never split
// across words, and cap each word so it stays within RFC 2047's 75-char limit.
function encodeHeaderValue(s: string): string {
  if (isAscii(s)) return s;
  const enc = new TextEncoder();
  const words: string[] = [];
  let buf: number[] = [];
  const flush = () => {
    if (!buf.length) return;
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    words.push('=?UTF-8?B?' + btoa(bin) + '?=');
    buf = [];
  };
  for (const ch of Array.from(s)) {
    const bytes = Array.from(enc.encode(ch));
    if (buf.length + bytes.length > 45) flush(); // 45 bytes → ≤60 base64 chars → word ≤72
    for (const b of bytes) buf.push(b);
  }
  flush();
  return words.join('\r\n '); // fold multiple encoded-words with a space
}

// Encode a single address. If it has a display name ("Name <email>") we encode
// only the name and leave the address untouched; a bare address is returned
// as-is.
function encodeAddress(addr: string): string {
  const m = String(addr).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return addr; // bare "email@host" — nothing to encode
  const name = m[1].replace(/^"|"$/g, '');
  if (!name || isAscii(name)) return addr;
  return encodeHeaderValue(name) + ' <' + m[2] + '>';
}

function foldBase64(b64: string): string {
  return (String(b64).replace(/\s+/g, '').match(/.{1,76}/g) || []).join('\r\n');
}

// The message body as a MIME part (multipart/alternative when HTML is present).
function bodyPart(text: string, html?: string): string {
  if (html) {
    const alt = 'gl_alt_' + Date.now();
    return [
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      '',
      `--${alt}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text,
      `--${alt}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
      `--${alt}--`,
    ].join('\r\n');
  }
  return ['Content-Type: text/plain; charset=UTF-8', '', text].join('\r\n');
}

function buildMime(
  from: string, to: string[], subject: string, text: string,
  html?: string, replyTo?: string,
  cc?: string[], bcc?: string[], attachments?: Attachment[],
): string {
  // RFC 2047 / RFC 2822: subjects and display names may contain non-ASCII,
  // so encode them; bare email addresses stay as-is.
  const headers: string[] = [
    `From: ${encodeAddress(from)}`,
    `To: ${to.map(encodeAddress).join(', ')}`,
  ];
  if (cc  && cc.length)  headers.push(`Cc: ${cc.map(encodeAddress).join(', ')}`);
  if (bcc && bcc.length) headers.push(`Bcc: ${bcc.map(encodeAddress).join(', ')}`); // Gmail delivers to Bcc and strips the header
  headers.push(`Subject: ${encodeHeaderValue(subject)}`);
  headers.push('MIME-Version: 1.0');
  if (replyTo) headers.push(`Reply-To: ${encodeAddress(replyTo)}`);

  const atts = (attachments || []).filter(a => a && a.filename && a.contentBase64);
  if (!atts.length) {
    // Headers + body part share one header block (bodyPart begins with Content-Type).
    return headers.join('\r\n') + '\r\n' + bodyPart(text, html);
  }

  // multipart/mixed: the body part, then each attachment.
  const mixed = 'gl_mixed_' + Date.now();
  const out: string[] = [
    headers.join('\r\n'),
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    bodyPart(text, html),
  ];
  for (const a of atts) {
    out.push(`--${mixed}`);
    out.push(`Content-Type: ${a.contentType || 'application/octet-stream'}; name="${a.filename}"`);
    out.push('Content-Transfer-Encoding: base64');
    out.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    out.push('');
    out.push(foldBase64(a.contentBase64));
  }
  out.push(`--${mixed}--`);
  return out.join('\r\n');
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

  // Authorize the caller: staff user JWT (or an internal service-role call).
  // A valid JWT alone is not enough — portal customers hold one too.
  const _auth = await requireStaff(req);
  if (!_auth.ok) return errorResponse(_auth.error || 'Forbidden', _auth.status);

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
  const cc  = normalizeList(payload.cc);
  const bcc = normalizeList(payload.bcc);
  const attachments = Array.isArray(payload.attachments) ? (payload.attachments as Attachment[]) : [];

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error('[gmail-send] token error:', e);
    return errorResponse('Token error: ' + String(e), 500);
  }

  const raw = toBase64url(buildMime(from, to, subject, text, html, replyTo, cc, bcc, attachments));

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
