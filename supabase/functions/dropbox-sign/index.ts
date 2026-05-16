// dropbox-sign — sends a signature request via Dropbox Sign (formerly HelloSign).
// Supports two flows:
//   1) Template-based   — use a pre-built template ID for NDAs, contracts, etc.
//   2) Raw-text         — send arbitrary text wrapped as a one-off PDF
//
// Request body (POST JSON), one of:
//   { template_id, signer_email, signer_name, title, subject?, message?, custom_fields? }
//   { raw_text,    signer_email, signer_name, title, subject?, message? }
//
// Response:
//   { ok: true, signature_request_id: string, signing_url?: string }
//   { error: string }
//
// Secrets required:
//   HELLOSIGN_API_KEY    — generate at https://app.hellosign.com/home/myAccount#api
//   HELLOSIGN_TEST_MODE  — "1" while testing (no real signatures), "0" for prod
//
// Deploy:
//   supabase functions deploy dropbox-sign
//   supabase secrets set HELLOSIGN_API_KEY=xxx
//   supabase secrets set HELLOSIGN_TEST_MODE=1

import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const HS_BASE = 'https://api.hellosign.com/v3';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const key = Deno.env.get('HELLOSIGN_API_KEY');
  if (!key) return errorResponse('HELLOSIGN_API_KEY not configured', 500);
  const testMode = (Deno.env.get('HELLOSIGN_TEST_MODE') || '1') === '1' ? '1' : '0';

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const signer_email = String(payload.signer_email || '').trim();
  const signer_name  = String(payload.signer_name  || '').trim();
  const title        = String(payload.title || 'Please sign').trim();
  const subject      = String(payload.subject || ('Signature requested: ' + title)).trim();
  const message      = String(payload.message || '').trim();

  if (!signer_email) return errorResponse('signer_email is required', 400);
  if (!signer_name)  return errorResponse('signer_name is required', 400);

  const template_id = payload.template_id ? String(payload.template_id) : '';
  const raw_text    = payload.raw_text    ? String(payload.raw_text)    : '';

  // Auth: HelloSign uses HTTP Basic with the API key as the username.
  const authHeader = 'Basic ' + btoa(`${key}:`);

  if (template_id) {
    // === Template flow ===
    // Uses signature_request/send_with_template. The template must have
    // exactly one signer role (we map our signer to the first role by index).
    const form = new URLSearchParams();
    form.set('test_mode', testMode);
    form.set('template_id', template_id);
    form.set('title', title);
    form.set('subject', subject);
    if (message) form.set('message', message);
    form.set('signers[0][role]', 'Signer');
    form.set('signers[0][name]', signer_name);
    form.set('signers[0][email_address]', signer_email);

    // Optional custom field map e.g. { brand_name: "SunBurst" }
    if (payload.custom_fields && typeof payload.custom_fields === 'object') {
      const cf = payload.custom_fields as Record<string, string>;
      let i = 0;
      for (const k of Object.keys(cf)) {
        form.set(`custom_fields[${i}][name]`, k);
        form.set(`custom_fields[${i}][value]`, String(cf[k]));
        i++;
      }
    }

    const r = await fetch(`${HS_BASE}/signature_request/send_with_template`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[dropbox-sign] template send error:', r.status, errText);
      return errorResponse('Dropbox Sign rejected the request', r.status, { hs_error: errText });
    }
    const data = await r.json();
    return jsonResponse({
      ok: true,
      signature_request_id: data?.signature_request?.signature_request_id,
      signing_url: data?.signature_request?.signing_url || null,
    });
  }

  if (raw_text) {
    // === Raw-text flow ===
    // Wraps the supplied plain-text into a tiny PDF on the fly. For
    // production we'd render a proper PDF; this is the minimum viable
    // "send something to sign right now" path.
    const pdfBytes = buildSimplePdf(raw_text);
    const form = new FormData();
    form.set('test_mode', testMode);
    form.set('title', title);
    form.set('subject', subject);
    if (message) form.set('message', message);
    form.set('signers[0][name]', signer_name);
    form.set('signers[0][email_address]', signer_email);
    form.set('files[0]', new Blob([pdfBytes], { type: 'application/pdf' }), 'document.pdf');

    const r = await fetch(`${HS_BASE}/signature_request/send`, {
      method: 'POST',
      headers: { 'Authorization': authHeader },
      body: form,
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[dropbox-sign] raw send error:', r.status, errText);
      return errorResponse('Dropbox Sign rejected the request', r.status, { hs_error: errText });
    }
    const data = await r.json();
    return jsonResponse({
      ok: true,
      signature_request_id: data?.signature_request?.signature_request_id,
      signing_url: data?.signature_request?.signing_url || null,
    });
  }

  return errorResponse('Either template_id or raw_text is required', 400);
});

// Minimal single-page PDF builder. Good enough for short text (under ~2KB).
// For real documents, generate the PDF on the client (or with a proper lib).
function buildSimplePdf(text: string): Uint8Array {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .split('\n');

  let stream = 'BT\n/F1 12 Tf\n50 770 Td\n14 TL\n';
  for (const line of escaped) {
    stream += `(${line}) Tj\nT*\n`;
  }
  stream += 'ET';

  const streamLen = new TextEncoder().encode(stream).length;
  const lines = [
    '%PDF-1.4',
    '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
    '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj',
    `4 0 obj <</Length ${streamLen}>> stream\n${stream}\nendstream\nendobj`,
    '5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj',
  ];
  const body = lines.join('\n') + '\n';
  const offsets: number[] = [];
  let pos = 0;
  for (const line of lines) {
    offsets.push(pos);
    pos += line.length + 1;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${lines.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer <</Size ${lines.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(body + xref + trailer);
}
