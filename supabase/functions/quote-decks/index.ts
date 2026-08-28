// quote-decks — emails a new lead our sales decks the moment they hit submit.
//
// WHY
// Mike's standing rule: every quote request gets the Good Liquid capabilities /
// pricing deck AND the Lotus Nutra R&D pricing deck, without him doing
// anything. Before this, both were sent by hand — which meant "by hand,
// eventually, when he saw the notification".
//
// WHERE THE PDFs COME FROM
// The private `sales-decks` storage bucket, listed by public.sales_decks
// (migration 20260828000000). They are deliberately NOT in the repo: the Lotus
// deck is stamped "Confidential Proposal" and carries a partner's internal
// pricing, and anything committed under the site root is served publicly by
// Vercel. Read here with the service role and attached to the mail, so no
// public URL for either deck exists anywhere.
//
// CALLERS
//   * public.gl_send_quote_decks(deal_id) via pg_net, from inside the public
//     submit_quote_request RPC — sends the shared gl_notify_secret in the body,
//     same pattern as estimate-deal-value / notify-deal.
//   * A staff session (requireStaff) — for a manual "resend the decks" action.
//
// The recipient is ALWAYS read from the deal row, never from the request body,
// so knowing the endpoint does not let anyone mail our decks to an address of
// their choosing.
//
// GUARDS
//   * The lead must exist, have an email, and not be closed.
//   * Skipped if this address already got the decks in the last 90 days
//     (email_log.template_name = 'quote_decks'), so a returning lead who files
//     a second request is not re-sent the same two PDFs.
//   * If no active deck has a file uploaded yet, NOTHING is sent — a prospect
//     must never receive a "here are our decks" email with nothing attached.
//   * Submission rate limiting is inherited from submit_quote_request itself
//     (3/hour per email, 15/10min site-wide).
//
// REQUEST (POST JSON): { deal_id: uuid, secret?: string, force?: boolean }
// RESPONSE: { ok, sent, attached: string[], missing: string[], skipped?: string }
//
// AUTH: verify_jwt = false (config.toml); the body secret OR a staff JWT.
// SECRETS: GL_NOTIFY_SECRET / Vault gl_notify_secret, plus the Mailgun secrets
// used by _shared/booking-email.ts.
//
// Deploy: supabase functions deploy quote-decks

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
import { vaultGet } from '../_shared/gmail-creds.ts';
import { sendMail, type MailAttachment } from '../_shared/booking-email.ts';

const BUCKET = 'sales-decks';
const TEMPLATE = 'quote_decks';
const RESEND_AFTER_DAYS = 90;
const BOOKING_URL = 'https://goodliquidbevco.com/book';
const CLOSED = new Set(['Closed Won', 'Closed Lost']);

interface DeckRow {
  key: string; label: string; filename: string;
  storage_path: string | null; sort_order: number;
}

function firstName(full: string): string {
  return String(full || '').trim().split(/\s+/)[0] || 'there';
}

// The CRM builds HTML by concatenation and a lead types their own name, so
// everything that reaches the HTML body gets escaped (CLAUDE.md rule #5).
function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
}

function bodyText(name: string): string {
  return `Hi ${firstName(name)},

Thanks for the inquiry — here is everything you need to price your project.

Attached:
  • Our capabilities and pricing deck — formats, minimums, per-can rates by
    volume, add-ons and lead times.
  • R&D pricing from Lotus Nutra, our formulation partner, if your formula
    still needs development or adjustment. Please treat that one as
    confidential.

The short version: our floor is 200 cases (4,800 cans) per SKU, we run 12oz
standard, 12oz sleek and 16oz cans on a cold-fill line, and per-can rates step
down at 340, 500, 1,000, 2,500 and 5,000 cases. If you already have a formula
there is no R&D fee — just a benchtop verification so we can confirm it runs
on our line.

Tell me your target can count, can size and whether the formula is finished,
and I will come back with an itemized quote. If it is easier to talk it
through, grab a time here: ${BOOKING_URL}

Thanks,
Mike Krail
Good Liquid Bev Co
2011 51st Ave E, Unit 100 · Palmetto, FL 34221
(803) 493-5065 · Mike@GoodLiquid.com`;
}

function bodyHtml(name: string): string {
  return '<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.7;max-width:620px;margin:0 auto">'
    + '<div style="border-top:3px solid #00e5c0;padding:22px 26px">'
    + '<div style="font-size:19px;font-weight:900;color:#00b89a;letter-spacing:2px;margin-bottom:12px">GOOD LIQUID BEV CO</div>'
    + `<p>Hi ${esc(firstName(name))},</p>`
    + '<p>Thanks for the inquiry — here is everything you need to price your project.</p>'
    + '<p><strong>Attached:</strong></p>'
    + '<ul>'
    + '<li>Our capabilities and pricing deck — formats, minimums, per-can rates by volume, add-ons and lead times.</li>'
    + '<li>R&amp;D pricing from <strong>Lotus Nutra</strong>, our formulation partner, if your formula still needs development or adjustment. Please treat that one as confidential.</li>'
    + '</ul>'
    + '<p>The short version: our floor is <strong>200 cases (4,800 cans) per SKU</strong>, we run 12oz standard, 12oz sleek and 16oz cans on a cold-fill line, and per-can rates step down at 340, 500, 1,000, 2,500 and 5,000 cases. If you already have a formula there is no R&amp;D fee — just a benchtop verification so we can confirm it runs on our line.</p>'
    + '<p>Tell me your target can count, can size and whether the formula is finished, and I will come back with an itemized quote.</p>'
    + `<p style="text-align:center;margin:26px 0"><a href="${BOOKING_URL}" style="background:#00e5c0;color:#04231d;text-decoration:none;font-weight:800;padding:13px 26px;border-radius:8px;display:inline-block">Book a 20-minute call →</a></p>`
    + '<p>Thanks,<br>Mike Krail<br>Good Liquid Bev Co<br>2011 51st Ave E, Unit 100 · Palmetto, FL 34221<br>(803) 493-5065 · Mike@GoodLiquid.com</p>'
    + '</div></div>';
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON', 400); }

  // Authorize: shared secret (the quote RPC) OR staff JWT (manual resend).
  const expected = (await vaultGet('gl_notify_secret')) || Deno.env.get('GL_NOTIFY_SECRET') || '';
  const secretOk = !!expected && body.secret === expected;
  if (!secretOk) {
    const auth = await requireStaff(req);
    if (!auth.ok) return errorResponse('Unauthorized', 401);
  }

  const dealId = String(body.deal_id || '').trim();
  if (!dealId) return errorResponse('deal_id required', 400);
  // force is honoured only for a staff-initiated resend; the automated path
  // must never be able to talk itself past the 90-day guard.
  const force = !secretOk && body.force === true;

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── The lead ──────────────────────────────────────────────────────────────
  const { data: deal, error: dErr } = await supa
    .from('deals')
    .select('id, client_name, contact_name, email, stage')
    .eq('id', dealId).maybeSingle();
  if (dErr) return errorResponse(`Deal lookup failed: ${dErr.message}`, 500);
  if (!deal) return errorResponse('Deal not found', 404);

  const to = String(deal.email || '').trim();
  if (!to) return jsonResponse({ ok: true, sent: false, skipped: 'lead has no email' });
  if (CLOSED.has(String(deal.stage || ''))) {
    return jsonResponse({ ok: true, sent: false, skipped: 'deal is closed' });
  }

  // ── Already had them? ─────────────────────────────────────────────────────
  if (!force) {
    const since = new Date(Date.now() - RESEND_AFTER_DAYS * 86400_000).toISOString();
    const { data: prior, error: pErr } = await supa
      .from('email_log')
      .select('id')
      .eq('template_name', TEMPLATE)
      .ilike('to_email', to)
      .gte('created_at', since)
      .limit(1);
    if (pErr) console.warn('[quote-decks] prior-send lookup failed:', pErr.message);
    if (prior && prior.length) {
      return jsonResponse({ ok: true, sent: false, skipped: 'already sent within 90 days' });
    }
  }

  // ── The decks ─────────────────────────────────────────────────────────────
  const { data: decks, error: kErr } = await supa
    .from('sales_decks')
    .select('key, label, filename, storage_path, sort_order')
    .eq('active', true)
    .order('sort_order');
  if (kErr) return errorResponse(`Deck list failed: ${kErr.message}`, 500);

  const attachments: MailAttachment[] = [];
  const attached: string[] = [];
  const missing: string[] = [];

  for (const d of (decks || []) as DeckRow[]) {
    if (!d.storage_path) { missing.push(d.key); continue; }
    const { data: file, error: fErr } = await supa.storage.from(BUCKET).download(d.storage_path);
    if (fErr || !file) {
      console.error('[quote-decks] deck download failed', d.key, fErr?.message);
      missing.push(d.key);
      continue;
    }
    attachments.push({
      filename: d.filename,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: 'application/pdf',
    });
    attached.push(d.key);
  }

  // Better to send nothing than to send a prospect an empty promise.
  if (!attachments.length) {
    console.error('[quote-decks] no deck files available — nothing sent', { dealId, missing });
    return jsonResponse({ ok: false, sent: false, attached, missing, skipped: 'no deck files uploaded' }, 200);
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const contact = String(deal.contact_name || '');
  const subject = 'Good Liquid Bev Co — capabilities, pricing & next steps';
  const res = await sendMail({
    to,
    subject,
    text: bodyText(contact),
    html: bodyHtml(contact),
    replyTo: 'Mike@GoodLiquid.com',
    attachments,
  });
  if (!res.ok) return errorResponse(`Send failed: ${res.error || 'unknown'}`, 502);

  // ── Log it so the CRM shows the same history it shows for every other mail ─
  const { error: lErr } = await supa.from('email_log').insert([{
    mailgun_id:    res.id || null,
    to_email:      to,
    subject,
    body_preview:  `Auto-sent on quote request. Attached: ${attached.join(', ')}`
                   + (missing.length ? ` · MISSING: ${missing.join(', ')}` : ''),
    template_name: TEMPLATE,
    direction:     'outbound',
    status:        'sent',
    sent_at:       new Date().toISOString(),
  }]);
  if (lErr) console.warn('[quote-decks] email_log insert failed:', lErr.message);

  return jsonResponse({ ok: true, sent: true, to, attached, missing });
});
