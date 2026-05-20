// mailgun-send — server-side proxy for sending email via Mailgun.
//
// Why this exists:
//   Previously sendMailgunEmail() in the browser called api.mailgun.net
//   directly using the Mailgun API key from localStorage. That meant the
//   key was readable by any browser extension, any XSS payload, or
//   anyone with physical access to a logged-in machine. This edge
//   function moves the key out of the client — it lives in Supabase
//   secrets and is only ever accessed server-side.
//
// Request body (POST JSON):
//   {
//     to:           string | string[]              required (comma-list or array)
//     subject:      string                          required
//     text:         string                          required (plain-text body)
//     html?:        string                          optional HTML alternative
//     cc?:          string | string[]               optional
//     bcc?:         string | string[]               optional
//     replyTo?:     string                          optional Reply-To header
//     attachments?: Array<{ filename, contentBase64, contentType? }>
//                                                   optional; base64-encoded
//     from?:        string                          optional override; defaults to MAILGUN_FROM
//     domain?:      string                          optional override; defaults to MAILGUN_DOMAIN
//   }
//
// Response:
//   { ok: true, id }      on success (id is Mailgun's message id)
//   { ok: false, error }  on failure
//
// Secrets required (set via `supabase secrets set`):
//   MAILGUN_API_KEY    — Mailgun private API key (key-xxx)
//   MAILGUN_DOMAIN     — e.g. mail.goodliquidbevco.com
//   MAILGUN_FROM       — default From header e.g. "Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>"
//
// Deploy:
//   supabase functions deploy mailgun-send

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const API_KEY = Deno.env.get('MAILGUN_API_KEY') || '';
const DEFAULT_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') || '';
const DEFAULT_FROM = Deno.env.get('MAILGUN_FROM') || '';

function normalizeList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  if (!API_KEY) return errorResponse('MAILGUN_API_KEY not configured', 500);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const to = normalizeList(payload.to);
  if (!to.length) return errorResponse('`to` required', 400);
  const subject = String(payload.subject || '').trim();
  if (!subject) return errorResponse('`subject` required', 400);
  const text = String(payload.text || '');
  if (!text) return errorResponse('`text` body required', 400);

  const domain = String(payload.domain || DEFAULT_DOMAIN);
  if (!domain) return errorResponse('domain not configured (no MAILGUN_DOMAIN secret + no domain in payload)', 400);
  const from = String(payload.from || DEFAULT_FROM);
  if (!from) return errorResponse('from not configured (no MAILGUN_FROM secret + no from in payload)', 400);

  const cc = normalizeList(payload.cc).filter(e => e !== to[0]);
  const bcc = normalizeList(payload.bcc).filter(e => e !== to[0]);

  const form = new FormData();
  form.set('from', from);
  form.set('to', to.join(', '));
  if (cc.length) form.set('cc', cc.join(', '));
  if (bcc.length) form.set('bcc', bcc.join(', '));
  form.set('subject', subject);
  form.set('text', text);
  if (payload.html) form.set('html', String(payload.html));
  if (payload.replyTo) form.set('h:Reply-To', String(payload.replyTo));
  // Force tracking on every send — webhook → email_log row update.
  form.set('o:tracking', 'yes');
  form.set('o:tracking-opens', 'yes');
  form.set('o:tracking-clicks', 'yes');

  if (Array.isArray(payload.attachments)) {
    for (const a of payload.attachments as Array<{ filename?: string; contentBase64?: string; contentType?: string }>) {
      if (!a || !a.filename || !a.contentBase64) continue;
      try {
        const bytes = decodeBase64(a.contentBase64);
        const blob = new Blob([bytes], { type: a.contentType || 'application/octet-stream' });
        form.append('attachment', blob, a.filename);
      } catch (e) {
        console.warn('[mailgun-send] bad attachment, skipping:', a.filename, e);
      }
    }
  }

  const auth = 'Basic ' + btoa('api:' + API_KEY);
  const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { 'Authorization': auth },
    body: form,
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '<no body>');
    console.error('[mailgun-send] Mailgun error:', r.status, errText);
    return errorResponse('Mailgun rejected: ' + errText, r.status);
  }
  const data = await r.json().catch(() => ({}));
  return jsonResponse({ ok: true, id: data.id || null, message: data.message || null });
});
