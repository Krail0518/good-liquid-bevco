// agreement-sign — built-in e-signatures for CRM agreements (NDA, manufacturing).
//
// Two kinds of caller:
//
//   STAFF (admin JWT, checked with requireStaff({role:'admin'})):
//     { action:'send',   agreement_id }  create the signer rows (client first,
//                                         then Good Liquid if a GL signer email
//                                         is on the agreement) and email the
//                                         first signer a link.
//     { action:'resend', agreement_id }  fresh link for whoever is up next.
//
//   PUBLIC (the /sign.html page — no login; the link token is the credential):
//     { action:'view',    token }                    agreement text + signer info
//     { action:'sign',    token, typed_name, consent:true }
//     { action:'decline', token, reason? }
//
// Tokens: 32 random bytes, base64url, sent only in the email. The database
// stores SHA-256(token), so a leaked table cannot be turned back into links.
// A token is valid for 30 days and only while its signer is up next; it is
// cleared once that signer signs or declines.
//
// When the last signer signs, this function builds the signed PDF (agreement
// text with "/s/ Name" in the signature block, plus a Signature Certificate
// page carrying each signer's consent, timestamps, IP, user agent and the
// SHA-256 of the exact text signed), files it in deal_documents / client-docs,
// marks the agreement signed and emails every signer a copy.
//
// Public actions are rate limited per IP; the function never accepts an
// agreement id from a public caller.
//
// Email goes out through the gmail-send function (the CRM's connected Google
// account). SITE_URL optional (defaults to https://www.goodliquidbevco.com).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
import { checkRateLimit, rateLimitMessage, rateLimitOutageMessage } from '../_shared/rate-limit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://www.goodliquidbevco.com').replace(/\/+$/, '');
const TOKEN_DAYS = 30;
const CONSENT_TEXT =
  'I agree to use electronic records and signatures, and I intend my typed name below to be my legal signature on this agreement, ' +
  'with the same effect as a handwritten signature (U.S. ESIGN Act, 15 U.S.C. 7001 et seq.; Florida Uniform Electronic Transaction Act, Fla. Stat. 668.50).';

const db = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function callerIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || 'unknown';
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function newToken(): Promise<{ token: string; hash: string }> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await sha256Hex(token) };
}
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// ── Email: through the CRM's connected Google account ─────────
// Good Liquid sends everything through Gmail (Admin → Email Delivery), not
// Mailgun. Reuse the gmail-send function so MIME building, attachments and the
// OAuth token refresh live in one place; the service-role bearer is accepted
// by its requireStaff() check as an internal call.
async function sendMail(opts: { to: string; subject: string; text: string; html: string;
  attachment?: { bytes: Uint8Array; name: string } }): Promise<{ ok: boolean; reason?: string }> {
  const body: Record<string, unknown> = { to: opts.to, subject: opts.subject, text: opts.text, html: opts.html };
  if (opts.attachment) {
    let bin = '';
    for (let i = 0; i < opts.attachment.bytes.length; i += 0x8000) bin += String.fromCharCode(...opts.attachment.bytes.subarray(i, i + 0x8000));
    body.attachments = [{ filename: opts.attachment.name, contentBase64: btoa(bin), contentType: 'application/pdf' }];
  }
  try {
    const r = await fetch(SUPABASE_URL + '/functions/v1/gmail-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      console.error('[agreement-sign] gmail-send failed', r.status, j && j.error);
      return { ok: false, reason: (j && j.error) || ('Email failed (' + r.status + ').') };
    }
    return { ok: true };
  } catch (e) {
    console.error('[agreement-sign] gmail-send threw', e);
    return { ok: false, reason: 'Email could not be sent.' };
  }
}

function emailShell(inner: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2433">
<div style="font-size:13px;letter-spacing:2px;color:#1a6fff;font-weight:800;margin-bottom:14px">GOOD LIQUID BEV CO</div>${inner}
<p style="font-size:12px;color:#7a8799;margin-top:28px">Good Liquid Bev Co · 2011 51st Ave E, Unit 100, Palmetto, FL 34221</p></div>`;
}

async function emailSignLink(signer: { name: string; email: string }, agreement: { title: string; party_name: string },
  token: string, glName: string): Promise<{ ok: boolean; reason?: string }> {
  // Token in the fragment: never sent to a server, so it stays out of logs.
  const link = `${SITE_URL}/sign.html#t=${encodeURIComponent(token)}`;
  const subject = `Please review and sign: ${agreement.title}`;
  const text = `Hi ${signer.name},\n\n${glName} has sent you "${agreement.title}" to review and sign electronically.\n\n` +
    `Open this private link to read and sign it:\n${link}\n\nThe link is personal to you and expires in ${TOKEN_DAYS} days.\n\nGood Liquid Bev Co`;
  const html = emailShell(
    `<p>Hi ${esc(signer.name)},</p>
<p>${esc(glName)} has sent you <b>${esc(agreement.title)}</b> to review and sign electronically.</p>
<p style="margin:26px 0"><a href="${esc(link)}" style="background:#1a6fff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Review &amp; sign</a></p>
<p style="font-size:13px;color:#5a6779">This link is personal to you and expires in ${TOKEN_DAYS} days. If the button does not work, copy this address into your browser:<br>${esc(link)}</p>`);
  return sendMail({ to: signer.email, subject, text, html });
}

// ── PDF ────────────────────────────────────────────────────────
// Standard PDF fonts only cover WinAnsi; map common typography and drop the rest.
function winAnsi(s: string): string {
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, '?');
}

type SignerRow = {
  id: string; role: string; sign_order: number; name: string; email: string; title: string | null;
  status: string; sent_at: string | null; viewed_at: string | null; consented_at: string | null;
  signed_at: string | null; typed_signature: string | null; signed_ip: string | null;
  signed_user_agent: string | null; document_sha256: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
}

// Fill "By: ____" / "Date: ____" in the signature block: the block is built by
// the CRM with Good Liquid first and Company second.
function stampSignatures(body: string, signers: SignerRow[]): string {
  const order = ['gl', 'client'];
  let i = 0, j = 0;
  let out = body.replace(/By: _{5,}/g, (m) => {
    const s = signers.find((x) => x.role === order[i++]);
    return s && s.typed_signature ? `By: /s/ ${s.typed_signature}` : m;
  });
  out = out.replace(/Date: _{5,}/g, (m) => {
    const s = signers.find((x) => x.role === order[j++]);
    return s && s.signed_at ? `Date: ${fmtDate(s.signed_at)}` : m;
  });
  return out;
}

async function buildSignedPdf(agreement: { id: string; title: string; body: string; kind: string },
  signers: SignerRow[], docHash: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(agreement.title + ' (signed)'));
  pdf.setCreator('Good Liquid Bev Co CRM');
  const reg = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const ital = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const W = 612, H = 792, M = 64, maxW = W - 2 * M;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  function wrap(text: string, font: typeof reg, size: number): string[] {
    const out: string[] = [];
    for (const raw of text.split('\n')) {
      if (raw === '') { out.push(''); continue; }
      let line = '';
      for (const word of raw.split(/ +/)) {
        const t = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(t, size) <= maxW) { line = t; continue; }
        if (line) out.push(line);
        // A single over-long token: hard-break it.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxW) {
          let k = w.length;
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }
  function draw(text: string, font: typeof reg, size: number, gapAfter: number, center = false) {
    const lh = size * 1.38;
    for (const ln of wrap(winAnsi(text), font, size)) {
      if (y - lh < M) { page = pdf.addPage([W, H]); y = H - M; }
      const x = center ? (W - font.widthOfTextAtSize(ln, size)) / 2 : M;
      page.drawText(ln, { x, y: y - size, size, font, color: rgb(0, 0, 0) });
      y -= lh;
    }
    y -= gapAfter;
  }

  const body = stampSignatures(agreement.body.replace(/\r\n/g, '\n'), signers);
  for (const block of body.split(/\n{2,}/)) {
    const t = block.replace(/\s+$/, '');
    if (!t) continue;
    if (t.startsWith('# ')) draw(t.slice(2), bold, 14, 10, true);
    else if (t.startsWith('## ')) { if (y - 40 < M) { page = pdf.addPage([W, H]); y = H - M; } draw(t.slice(3), bold, 11.5, 2); }
    else draw(t, reg, 11, 7);
  }

  // Signature certificate
  page = pdf.addPage([W, H]); y = H - M;
  draw('SIGNATURE CERTIFICATE', bold, 14, 8, true);
  draw(`Document: ${agreement.title}`, reg, 10.5, 2);
  draw(`Agreement ID: ${agreement.id}`, reg, 10.5, 2);
  draw(`SHA-256 of the signed text: ${docHash}`, reg, 9.5, 10);
  draw('Each signer opened the document through a private link emailed to the address below, agreed to sign electronically, and adopted the typed signature shown.', ital, 10, 10);
  for (const s of [...signers].sort((a, b) => a.sign_order - b.sign_order)) {
    draw(`${s.role === 'gl' ? 'Good Liquid' : 'Company'}: ${s.name}${s.title ? ', ' + s.title : ''}`, bold, 11, 2);
    draw(`Signature adopted: /s/ ${s.typed_signature || ''}`, ital, 11, 2);
    draw(`Email: ${s.email}`, reg, 10, 1);
    if (s.sent_at) draw(`Link sent: ${new Date(s.sent_at).toISOString()}`, reg, 10, 1);
    if (s.viewed_at) draw(`Viewed: ${new Date(s.viewed_at).toISOString()}`, reg, 10, 1);
    if (s.consented_at) draw(`Consented to electronic signature: ${new Date(s.consented_at).toISOString()}`, reg, 10, 1);
    if (s.signed_at) draw(`Signed: ${new Date(s.signed_at).toISOString()}`, reg, 10, 1);
    draw(`IP address: ${s.signed_ip || 'unknown'}`, reg, 10, 1);
    draw(`Browser: ${(s.signed_user_agent || 'unknown').slice(0, 180)}`, reg, 9, 1);
    draw(`Text hash at signing: ${s.document_sha256 || ''}`, reg, 9, 10);
  }
  draw('Consent statement each signer accepted:', bold, 10, 2);
  draw(CONSENT_TEXT, reg, 10, 0);

  const n = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    const label = winAnsi(`${agreement.kind === 'nda' ? 'Confidential   ·   ' : ''}Page ${i + 1} of ${n}   ·   Signed electronically`);
    p.drawText(label, { x: (W - reg.widthOfTextAtSize(label, 8.5)) / 2, y: 30, size: 8.5, font: reg, color: rgb(0.45, 0.45, 0.45) });
  });
  return await pdf.save();
}

// ── Helpers on rows ────────────────────────────────────────────
async function loadByToken(sb: ReturnType<typeof db>, token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { error: 'This signing link is not valid.' };
  const hash = await sha256Hex(token);
  const { data: signer } = await sb.from('agreement_signers').select('*').eq('token_hash', hash).maybeSingle();
  if (!signer) return { error: 'This signing link is not valid or has already been used.' };
  if (signer.token_expires_at && new Date(signer.token_expires_at) < new Date()) {
    return { error: 'This signing link has expired. Ask Good Liquid to send a new one.' };
  }
  const { data: agreement } = await sb.from('agreements')
    .select('id,kind,title,party_name,body,status,client_id,deal_id,fields').eq('id', signer.agreement_id).maybeSingle();
  if (!agreement) return { error: 'This agreement no longer exists.' };
  if (agreement.status === 'void') return { error: 'This agreement was withdrawn by Good Liquid.' };
  if (agreement.status === 'declined') return { error: 'This agreement was declined and is closed.' };
  return { signer, agreement };
}

async function startNextSigner(sb: ReturnType<typeof db>, agreement: { id: string; title: string; party_name: string; fields: Record<string, string> }) {
  const { data: rows } = await sb.from('agreement_signers').select('*').eq('agreement_id', agreement.id).order('sign_order');
  const next = (rows || []).find((r: SignerRow) => r.status !== 'signed');
  if (!next) return { ok: true, done: true };
  const t = await newToken();
  const upd = await sb.from('agreement_signers').update({
    status: 'sent', token_hash: t.hash, sent_at: new Date().toISOString(),
    token_expires_at: new Date(Date.now() + TOKEN_DAYS * 864e5).toISOString(),
  }).eq('id', next.id).select('id');
  if (upd.error || !upd.data?.length) return { ok: false, reason: 'Could not prepare the signing link.' };
  const glName = (agreement.fields && agreement.fields.gl_legal_name) || 'Good Liquid Bev Co';
  const mail = await emailSignLink(next, agreement, t.token, glName);
  if (!mail.ok) return { ok: false, reason: mail.reason };
  return { ok: true, done: false, sentTo: next.email };
}

async function finalize(sb: ReturnType<typeof db>, agreementId: string) {
  const { data: agreement } = await sb.from('agreements').select('*').eq('id', agreementId).single();
  const { data: signers } = await sb.from('agreement_signers').select('*').eq('agreement_id', agreementId).order('sign_order');
  const docHash = await sha256Hex(agreement.body);
  const bytes = await buildSignedPdf(agreement, signers as SignerRow[], docHash);
  const base = agreement.deal_id ? `deal/${agreement.deal_id}` : `${agreement.client_id}/docs`;
  const path = `${base}/${Date.now()}_${crypto.randomUUID().slice(0, 5)}.pdf`;
  const up = await sb.storage.from('client-docs').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) { console.error('[agreement-sign] upload', up.error); return; }
  const doc = await sb.from('deal_documents').insert([{
    deal_id: agreement.deal_id, client_id: agreement.client_id,
    doc_type: agreement.kind === 'nda' ? 'NDA' : 'Manufacturing Agreement',
    name: 'SIGNED ' + agreement.title, notes: 'Signed electronically in the CRM', file_path: path,
    file_type: 'pdf', uploaded_by: 'E-signature',
    // The fully signed copy is published to the client's portal (Mike,
    // 2026-10-07). Drafts and unsigned versions stay internal (the default).
    // A deal-only agreement has no client_id yet; it becomes visible to the
    // client once convert-to-client stamps client_id on the row.
    client_visible: true,
  }]).select('id').single();
  if (doc.error) { console.error('[agreement-sign] doc row', doc.error); return; }
  const lastSigned = (signers as SignerRow[]).reduce((m, s) => (s.signed_at && s.signed_at > m ? s.signed_at : m), '');
  await sb.from('agreements').update({
    status: 'signed', signed_document_id: doc.data.id, signed_at: lastSigned || new Date().toISOString(),
  }).eq('id', agreementId).select('id');
  const fileName = (agreement.title + ' - signed').replace(/[^A-Za-z0-9 ._-]+/g, '').slice(0, 100) + '.pdf';
  for (const s of signers as SignerRow[]) {
    await sendMail({
      to: s.email,
      subject: `Signed: ${agreement.title}`,
      text: `Hi ${s.name},\n\n"${agreement.title}" has been signed by everyone. A copy of the signed agreement is attached for your records.\n\nGood Liquid Bev Co`,
      html: emailShell(`<p>Hi ${esc(s.name)},</p><p><b>${esc(agreement.title)}</b> has been signed by everyone. A copy of the signed agreement is attached for your records.</p>`),
      attachment: { bytes, name: fileName },
    });
  }
}

// ── Handler ────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return errorResponse('Server not configured', 500);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return errorResponse('Invalid JSON body', 400); }
  const action = String(payload.action || '');
  const sb = db();

  // ── Staff actions ──
  if (action === 'send' || action === 'resend') {
    const auth = await requireStaff(req, { role: 'admin' });
    if (!auth.ok) return errorResponse(auth.error || 'Forbidden', auth.status);
    const rl = await checkRateLimit('agreement-sign:staff:' + (auth.userId || 'svc'), 30, 300, { onOutage: 'allowance' });
    if (!rl.allowed) return errorResponse(rl.outage ? rateLimitOutageMessage('agreement email') : rateLimitMessage('agreement email'), rl.outage ? 503 : 429);

    const agreementId = String(payload.agreement_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(agreementId)) return errorResponse('agreement_id is required', 400);
    const { data: agreement } = await sb.from('agreements').select('id,title,party_name,status,fields').eq('id', agreementId).maybeSingle();
    if (!agreement) return errorResponse('Agreement not found', 404);
    if (agreement.status === 'signed' || agreement.status === 'void' || agreement.status === 'declined') {
      return errorResponse('This agreement is ' + agreement.status + ' and cannot be sent.', 409);
    }

    if (action === 'send') {
      const f = (agreement.fields || {}) as Record<string, string>;
      const clientEmail = String(f.client_signer_email || '').trim();
      if (!validEmail(clientEmail)) return errorResponse('The agreement has no valid client signer email.', 400);
      const rows: Record<string, unknown>[] = [{
        agreement_id: agreementId, role: 'client', sign_order: 1,
        name: String(f.client_signer_name || agreement.party_name).trim(), email: clientEmail,
        title: String(f.client_signer_title || '').trim() || null, status: 'waiting',
      }];
      const glEmail = String(f.gl_signer_email || '').trim();
      if (validEmail(glEmail) && glEmail.toLowerCase() !== clientEmail.toLowerCase()) {
        rows.push({
          agreement_id: agreementId, role: 'gl', sign_order: 2,
          name: String(f.gl_signer_name || 'Good Liquid Bev Co').trim(), email: glEmail,
          title: String(f.gl_signer_title || '').trim() || null, status: 'waiting',
        });
      }
      // A re-send of a never-signed agreement starts the signer list over.
      const del = await sb.from('agreement_signers').delete().eq('agreement_id', agreementId).neq('status', 'signed').select('id');
      if (del.error) return errorResponse('Could not reset signers: ' + del.error.message, 500);
      const ins = await sb.from('agreement_signers').upsert(rows, { onConflict: 'agreement_id,role', ignoreDuplicates: true }).select('id');
      if (ins.error) return errorResponse('Could not create signers: ' + ins.error.message, 500);
    }

    const started = await startNextSigner(sb, agreement);
    if (!started.ok) return errorResponse(started.reason || 'Could not send', 502);
    if (started.done) return errorResponse('Everyone has already signed.', 409);
    const upd = await sb.from('agreements').update({
      status: 'sent', sent_to: started.sentTo, sent_at: new Date().toISOString(),
    }).eq('id', agreementId).select('id');
    if (upd.error || !upd.data?.length) return errorResponse('Email sent, but the status did not save.', 500);
    return jsonResponse({ ok: true, sent_to: started.sentTo });
  }

  // ── Public actions (token) ──
  if (action === 'view' || action === 'sign' || action === 'decline') {
    const ip = callerIp(req);
    const rl = await checkRateLimit('agreement-sign:public:' + ip, 30, 300, { onOutage: 'closed' });
    if (!rl.allowed) return errorResponse(rl.outage ? rateLimitOutageMessage('signing') : rateLimitMessage('signing'), rl.outage ? 503 : 429);

    const loaded = await loadByToken(sb, String(payload.token || ''));
    if ('error' in loaded) return errorResponse(loaded.error as string, 404);
    const { signer, agreement } = loaded as { signer: SignerRow & { agreement_id: string }; agreement: Record<string, unknown> & { id: string; title: string; body: string; fields: Record<string, string>; party_name: string } };

    if (signer.status === 'signed') return jsonResponse({ ok: true, already: 'signed', title: agreement.title });

    if (action === 'view') {
      if (!signer.viewed_at) {
        await sb.from('agreement_signers').update({ status: 'viewed', viewed_at: new Date().toISOString() })
          .eq('id', signer.id).select('id');
      }
      const f = agreement.fields || {};
      return jsonResponse({
        ok: true,
        title: agreement.title,
        body: agreement.body,
        signer: { name: signer.name, email: signer.email, title: signer.title, role: signer.role },
        parties: { good_liquid: f.gl_legal_name || 'Good Liquid Bev Co', company: f.client_legal_name || agreement.party_name },
        consent_text: CONSENT_TEXT,
      });
    }

    if (action === 'decline') {
      const reason = String(payload.reason || '').trim().slice(0, 1000) || null;
      await sb.from('agreement_signers').update({
        status: 'declined', decline_reason: reason, token_hash: null, signed_ip: ip,
        signed_user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
      }).eq('id', signer.id).select('id');
      await sb.from('agreements').update({ status: 'declined' }).eq('id', agreement.id).select('id');
      const glEmail = String((agreement.fields || {}).gl_signer_email || '').trim();
      if (validEmail(glEmail)) {
        await sendMail({
          to: glEmail, subject: `Declined: ${agreement.title}`,
          text: `${signer.name} (${signer.email}) declined to sign "${agreement.title}".${reason ? '\n\nReason: ' + reason : ''}`,
          html: emailShell(`<p><b>${esc(signer.name)}</b> (${esc(signer.email)}) declined to sign <b>${esc(agreement.title)}</b>.</p>${reason ? `<p>Reason: ${esc(reason)}</p>` : ''}`),
        });
      }
      return jsonResponse({ ok: true, declined: true });
    }

    // sign
    if (payload.consent !== true) return errorResponse('Please agree to sign electronically.', 400);
    const typed = String(payload.typed_name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (typed.length < 2) return errorResponse('Type your full name to sign.', 400);
    const now = new Date().toISOString();
    const docHash = await sha256Hex(agreement.body);
    const upd = await sb.from('agreement_signers').update({
      status: 'signed', consented_at: now, signed_at: now, typed_signature: typed,
      signed_ip: ip, signed_user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
      document_sha256: docHash, token_hash: null, token_expires_at: null,
    }).eq('id', signer.id).eq('status', signer.status).select('id');
    if (upd.error || !upd.data?.length) return errorResponse('Your signature could not be saved. Please try again.', 500);

    const next = await startNextSigner(sb, agreement as never);
    if (next.ok && next.done) await finalize(sb, agreement.id);
    else if (!next.ok) console.error('[agreement-sign] next signer email failed:', next.reason);
    return jsonResponse({ ok: true, signed: true, complete: !!(next.ok && next.done) });
  }

  return errorResponse('Unknown action', 400);
});
