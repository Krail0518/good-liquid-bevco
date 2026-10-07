// dropbox-sign — sends a signature request via Dropbox Sign (formerly HelloSign).
// Supports two flows:
//   1) Template-based   — use a pre-built template ID for NDAs, contracts, etc.
//   2) Raw-text         — send arbitrary text wrapped as a one-off PDF
//
// Request body (POST JSON), one of:
//   { template_id, signer_email, signer_name, title, subject?, message?, custom_fields? }
//   { raw_text,    signer_email, signer_name, title, subject?, message? }
//   { file_base64, file_name?, signer_email, signer_name, title, subject?, message?,
//     cc_signer?: { name, email } }          — a finished PDF (agreements)
//   { action: 'status', signature_request_id } — is it fully signed yet?
//   { action: 'file',   signature_request_id } — the signed PDF, base64
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
import { requireStaff } from '../_shared/auth.ts';
import { checkRateLimit, rateLimitMessage, rateLimitOutageMessage } from '../_shared/rate-limit.ts';

const HS_BASE = 'https://api.hellosign.com/v3';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Authorize the caller: staff user JWT (or an internal service-role call).
  // A valid JWT alone is not enough — portal customers hold one too.
  const _auth = await requireStaff(req);
  if (!_auth.ok) return errorResponse(_auth.error || 'Forbidden', _auth.status);

  // Bound how often ONE account can spend money here. Authorization above says
  // who may call; this says how often. Keyed by user so one account cannot
  // exhaust everyone else's budget. What happens when the counter itself
  // is down is chosen per endpoint — see rate-limit.ts.
  const _rl = await checkRateLimit(
    'dropbox-sign:' + (_auth.userId || 'role:' + (_auth.role || 'unknown')),
    10, 300,
    // An envelope costs real money per send and signing can wait.
    { onOutage: 'closed' },
  );
  if (_rl.degraded) console.warn('[dropbox-sign] rate limit check degraded:', _rl.degraded);
  if (!_rl.allowed) {
    return _rl.outage
      ? errorResponse(rateLimitOutageMessage('signature'), 503)
      : errorResponse(rateLimitMessage('signature'), 429);
  }

  const key = Deno.env.get('HELLOSIGN_API_KEY');
  if (!key) return errorResponse('HELLOSIGN_API_KEY not configured', 500);
  const testMode = (Deno.env.get('HELLOSIGN_TEST_MODE') || '1') === '1' ? '1' : '0';

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  // Auth: HelloSign uses HTTP Basic with the API key as the username.
  const basicAuth = 'Basic ' + btoa(`${key}:`);

  const action = payload.action ? String(payload.action) : '';
  if (action === 'status' || action === 'file') {
    const reqId = String(payload.signature_request_id || '').trim();
    if (!/^[A-Za-z0-9]{8,64}$/.test(reqId)) return errorResponse('signature_request_id is required', 400);
    if (action === 'status') {
      const r = await fetch(`${HS_BASE}/signature_request/${reqId}`, { headers: { 'Authorization': basicAuth } });
      if (!r.ok) {
        const errText = await r.text();
        console.error('[dropbox-sign] status error:', r.status, errText);
        return errorResponse('Dropbox Sign could not look up that request', r.status, { hs_error: errText });
      }
      const data = await r.json();
      const sr = data?.signature_request || {};
      return jsonResponse({
        ok: true,
        is_complete: !!sr.is_complete,
        is_declined: !!sr.is_declined,
        signatures: (sr.signatures || []).map((x: Record<string, unknown>) => ({
          name: x.signer_name, email: x.signer_email_address,
          status: x.status_code, signed_at: x.signed_at,
        })),
      });
    }
    const r = await fetch(`${HS_BASE}/signature_request/files/${reqId}?file_type=pdf`, { headers: { 'Authorization': basicAuth } });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[dropbox-sign] file error:', r.status, errText);
      return errorResponse('Dropbox Sign could not return the signed file', r.status, { hs_error: errText });
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return jsonResponse({ ok: true, file_base64: btoa(bin) });
  }

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

  const file_base64 = payload.file_base64 ? String(payload.file_base64) : '';
  if (file_base64) {
    // === Finished-PDF flow (agreements) ===
    // The browser renders the document; we only forward it. Bounded so one
    // call cannot push an arbitrarily large upload through the function.
    if (file_base64.length > 8_000_000) return errorResponse('PDF too large (max ~6 MB)', 413);
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0)); }
    catch { return errorResponse('file_base64 is not valid base64', 400); }
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
      return errorResponse('file_base64 must be a PDF', 400);
    }
    const fileName = String(payload.file_name || 'agreement.pdf').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 120) || 'agreement.pdf';
    const form = new FormData();
    form.set('test_mode', testMode);
    form.set('title', title);
    form.set('subject', subject);
    if (message) form.set('message', message);
    // Signature pages are placed by Dropbox Sign itself (no text tags).
    form.set('signers[0][name]', signer_name);
    form.set('signers[0][email_address]', signer_email);
    const cc = payload.cc_signer as Record<string, unknown> | undefined;
    if (cc && typeof cc === 'object' && String(cc.email || '').trim()) {
      form.set('signers[1][name]', String(cc.name || 'Good Liquid Bev Co').trim());
      form.set('signers[1][email_address]', String(cc.email).trim());
    }
    form.set('files[0]', new Blob([bytes], { type: 'application/pdf' }), fileName);
    const r = await fetch(`${HS_BASE}/signature_request/send`, {
      method: 'POST',
      headers: { 'Authorization': basicAuth },
      body: form,
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[dropbox-sign] file send error:', r.status, errText);
      return errorResponse('Dropbox Sign rejected the request', r.status, { hs_error: errText });
    }
    const data = await r.json();
    return jsonResponse({
      ok: true,
      signature_request_id: data?.signature_request?.signature_request_id,
      signing_url: data?.signature_request?.signing_url || null,
    });
  }

  return errorResponse('Either template_id, raw_text or file_base64 is required', 400);
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
