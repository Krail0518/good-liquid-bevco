// notify-deal — internal notification dispatcher for pipeline deals and tour bookings.
// Sends Mike a Telegram message and a Gmail notification email. (WhatsApp via
// CallMeBot was removed 2026-10-11: its free quota ran out and Telegram took over.)
//
// Called from:
//   • booking-confirm  (tour booked via public book.html)
//   • index.html       (deal manually added in CRM, or tour booked via CRM widget)
//   • request-a-quote.html  (public quote request form)
//   • Supabase DB trigger on deals INSERT
//   • Supabase DB trigger on customer_requests INSERT ('portal_request')
//   • gmail-sync, for freshly imported client/lead mail
//     ('client_email_reply', or 'client_email_replies' as one summary)
//
// Every dispatch is recorded in public.notification_log (server-only), which
// the daily inbound-heartbeat reads to report whether alerts are arriving.
// If an alert reaches neither Telegram nor email, a warning goes straight to
// Telegram.
//
// Request body (POST JSON):
//   {
//     event:  'tour_booked' | 'new_deal' | 'new_quote'
//     secret: string    // must match GL_NOTIFY_SECRET env var
//     data: {
//       name?:    string   // person's name or deal name
//       company?: string
//       email?:   string
//       phone?:   string
//       date?:    string   // for tour events
//       time?:    string   // for tour events
//       service?: string
//       stage?:   string
//     }
//   }
//
// Secrets required:
//   GL_NOTIFY_SECRET          — shared secret, also stored in Postgres vault
//   SUPABASE_URL              — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided
//
// Deploy:
//   supabase functions deploy notify-deal
//   supabase secrets set CALLMEBOT_PHONE=18034935065 CALLMEBOT_API_KEY=<key>

import { corsHeaders, jsonResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
// vaultGet is the generic service-role Vault reader (it lives in
// gmail-creds.ts for historical reasons; the gl_notify_secret is unrelated
// to Gmail).
import { vaultGet } from '../_shared/gmail-creds.ts';
import { sendTelegram, setupTelegram } from '../_shared/telegram.ts';
import { sendAlertEmail, logNotification, type EmailResult } from '../_shared/alert-delivery.ts';
import {
  portalRequestMessage, clientReplyMessage, clientRepliesSummary, deliveryFailureWarning,
} from '../_shared/inbound-alarms.mjs';

const MIKE_EMAILS = ['mike@goodliquid.com'];
const EMOJI_MAP: Record<string, string> = {
  lead_sla_overdue:   '⚠️',
  followups_ready:    '✍️',
  tour_requested:     '📅',
  tour_booked:        '📅',
  new_deal:           '📋',
  deals_imported:     '📋',
  new_quote:          '📩',
  invoice_paid_stripe:'💳',
  invoice_paid_manual:'✅',
  invoice_paid_bulk:  '✅',
  deal_closed_won:    '🏆',
  new_client:         '🤝',
  invoice_sent:       '📤',
  invoice_sent_bulk:  '📤',
  client_email_reply: '📬',
  new_referral:       '🌟',
  onboarding_complete:'🚀',
};

// gmail-send with a retry on 429 / 5xx (see _shared/alert-delivery.ts). The
// first version gave up on the first 429, so a burst of alerts lost emails.
function sendEmail(subject: string, text: string): Promise<EmailResult> {
  return sendAlertEmail('notify-deal', MIKE_EMAILS, subject, text);
}

function buildMessage(event: string, data: Record<string, string>): { chatText: string; subject: string; body: string } {
  const emoji = EMOJI_MAP[event] || '🔔';
  const co    = data.company || data.name || 'Unknown';
  const name  = data.name || '';

  if (event === 'lead_sla_overdue') {
    const n = data.count || '1';
    const chatText = `${emoji} ${n} lead${n === '1' ? '' : 's'} still waiting on a FIRST reply (past 1 business day):\n${data.summary || ''}`;
    const body = [
      `${n} lead(s) have gone past the one-business-day first-reply mark with no response from us:`,
      ``,
      data.summary || '',
      ``,
      `Open the pipeline and get back to them before they go cold.`,
    ].join('\n');
    return { chatText, subject: `⚠️ ${n} lead(s) awaiting a first reply`, body };
  }

  if (event === 'followups_ready') {
    const n = data.count || '1';
    const link = data.review_url ? ` Review & send: ${data.review_url}` : '';
    const chatText = `${emoji} ${n} follow-up${n === '1' ? '' : 's'} drafted and ready to send to quiet leads.${link}`;
    const body = [
      `${n} follow-up email(s) have been drafted for leads that went quiet.`,
      ``,
      data.review_url ? `Review and send them with one tap: ${data.review_url}` : `Open the CRM Follow-ups card to review and send.`,
    ].join('\n');
    return { chatText, subject: `✍️ ${n} follow-up(s) ready to send`, body };
  }

  if (event === 'tour_requested') {
    const when     = data.date ? `${data.date} at ${data.time || ''}`.trim() : 'time TBD';
    const review   = data.review_url ? ` Approve/decline: ${data.review_url}` : '';
    const chatText = `${emoji} TOUR REQUEST: ${name}${data.company ? ' (' + data.company + ')' : ''} wants ${when}. Email: ${data.email || 'n/a'}.${review}`;
    const body     = [
      `New tour request via Good Liquid scheduling link — awaiting your approval.`,
      ``,
      `Name:    ${name}`,
      `Company: ${data.company || '—'}`,
      `Email:   ${data.email   || '—'}`,
      `When:    ${when}`,
      ``,
      data.review_url ? `Approve or decline: ${data.review_url}` : '',
    ].filter(Boolean).join('\n');
    return { chatText, subject: `📅 Approve tour? ${name} — ${when}`, body };
  }

  if (event === 'tour_booked') {
    const when     = data.date ? `${data.date} at ${data.time || ''}`.trim() : 'time TBD';
    const chatText = `${emoji} TOUR BOOKED: ${name}${data.company ? ' (' + data.company + ')' : ''} — ${when}. Email: ${data.email || 'n/a'}`;
    const body     = [
      `Tour booked via Good Liquid scheduling link.`,
      ``,
      `Name:    ${name}`,
      `Company: ${data.company || '—'}`,
      `Email:   ${data.email   || '—'}`,
      `Phone:   ${data.phone   || '—'}`,
      `When:    ${when}`,
    ].join('\n');
    return { chatText, subject: `📅 New tour: ${name} — ${when}`, body };
  }

  if (event === 'new_quote') {
    const chatText = `${emoji} NEW QUOTE REQUEST from ${co}${data.email ? ' (' + data.email + ')' : ''}. Service: ${data.service || 'TBD'}. Check the pipeline.`;
    const body     = [
      `New quote request submitted via goodliquidbevco.com.`,
      ``,
      `Brand:   ${co}`,
      `Contact: ${name}`,
      `Email:   ${data.email   || '—'}`,
      `Phone:   ${data.phone   || '—'}`,
      `Service: ${data.service || '—'}`,
      `Volume:  ${data.volume  || '—'}`,
    ].join('\n');
    return { chatText, subject: `📩 New quote: ${co}`, body };
  }

  if (event === 'invoice_paid_stripe' || event === 'invoice_paid_manual') {
    const amt      = data.amount ? ` — $${parseFloat(data.amount).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}` : '';
    const method   = event === 'invoice_paid_stripe' ? ' via Stripe' : ' (manual)';
    const chatText = `${emoji} INVOICE PAID${method}: ${data.invoice_number || '—'} · ${data.client || co}${amt}`;
    const body     = [
      `Invoice marked paid${method}.`,
      ``,
      `Invoice: ${data.invoice_number || '—'}`,
      `Client:  ${data.client || co}`,
      `Amount:  ${amt ? amt.trim() : '—'}`,
    ].join('\n');
    return { chatText, subject: `${emoji} Invoice paid: ${data.invoice_number || co}${amt}`, body };
  }

  if (event === 'invoice_paid_bulk') {
    const chatText = `${emoji} BULK PAYMENT: ${data.count || '?'} invoice${Number(data.count)===1?'':'s'} marked paid. Check the dashboard.`;
    const body     = `${data.count || '?'} invoice${Number(data.count)===1?'':'s'} marked paid in bulk.`;
    return { chatText, subject: `✅ ${data.count} invoices paid`, body };
  }

  if (event === 'deal_closed_won') {
    const val      = data.value ? ` · $${parseFloat(data.value).toLocaleString()}` : '';
    const chatText = `${emoji} CLOSED WON: ${co}${val}. 🎉 Check the pipeline.`;
    const body     = [
      `Deal moved to Closed Won.`,
      ``,
      `Deal:    ${name}`,
      `Company: ${data.company || '—'}`,
      `Value:   ${val ? val.trim() : '—'}`,
      `Email:   ${data.email || '—'}`,
      `Phone:   ${data.phone || '—'}`,
    ].join('\n');
    return { chatText, subject: `🏆 Closed Won: ${co}${val}`, body };
  }

  if (event === 'new_client') {
    const chatText = `${emoji} NEW CLIENT: ${co}${data.contact ? ' · ' + data.contact : ''}. Service: ${data.service || 'TBD'}. Source: ${data.lead_source || 'unknown'}.`;
    const body     = [
      `New client added to the CRM.`,
      ``,
      `Brand:   ${co}`,
      `Contact: ${data.contact  || '—'}`,
      `Email:   ${data.email    || '—'}`,
      `Phone:   ${data.phone    || '—'}`,
      `Service: ${data.service  || '—'}`,
      `Source:  ${data.lead_source || '—'}`,
    ].join('\n');
    return { chatText, subject: `🤝 New client: ${co}`, body };
  }

  if (event === 'invoice_sent' || event === 'invoice_sent_bulk') {
    if (event === 'invoice_sent_bulk') {
      const chatText = `${emoji} BULK SEND: ${data.count} invoice${Number(data.count)===1?'':'s'} sent${data.failed && data.failed!=='0' ? ', ' + data.failed + ' failed' : ''}.`;
      const body     = `${data.count} invoice${Number(data.count)===1?'':'s'} sent via Gmail bulk send.`;
      return { chatText, subject: `📤 ${data.count} invoices sent`, body };
    }
    const amt      = data.amount ? ` · $${parseFloat(data.amount).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}` : '';
    const chatText = `${emoji} INVOICE SENT: ${data.invoice_number || '—'} → ${data.client || co}${amt}. To: ${data.to || '—'}`;
    const body     = [
      `Invoice sent via Gmail.`,
      ``,
      `Invoice: ${data.invoice_number || '—'}`,
      `Client:  ${data.client || co}`,
      `Amount:  ${amt ? amt.trim() : '—'}`,
      `To:      ${data.to || '—'}`,
    ].join('\n');
    return { chatText, subject: `📤 Invoice sent: ${data.invoice_number || co}`, body };
  }

  // Client / lead email replies: fired by gmail-sync for freshly imported
  // inbound mail (one each for up to 3, otherwise one summary), and by the
  // legacy mailgun-inbound. Text lives in _shared/inbound-alarms.mjs (tested).
  if (event === 'client_email_reply') {
    const m = clientReplyMessage(data);
    return { chatText: m.short, subject: m.subject, body: m.body };
  }
  if (event === 'client_email_replies') {
    const m = clientRepliesSummary(data);
    return { chatText: m.short, subject: m.subject, body: m.body };
  }

  // Customer portal requests — fired by the customer_requests insert trigger
  // (20261012010000_inbound_alarms.sql). They had no alert at all before.
  if (event === 'portal_request') {
    const m = portalRequestMessage(data);
    return { chatText: m.short, subject: m.subject, body: m.body };
  }

  if (event === 'new_referral') {
    const comm     = data.amount ? ` · $${parseFloat(data.amount).toLocaleString()} commission` : '';
    const chatText = `${emoji} NEW REFERRAL: ${data.company || '—'} referred ${name || '—'}${comm}.`;
    const body     = [
      `New referral logged.`,
      ``,
      `Referred by: ${data.company || '—'}`,
      `Client:      ${name || '—'}`,
      `Commission:  ${comm ? comm.replace(' · ', '') : '—'}`,
    ].join('\n');
    return { chatText, subject: `🌟 Referral: ${name} from ${data.company || '—'}`, body };
  }

  if (event === 'onboarding_complete') {
    const chatText = `${emoji} ONBOARDING DONE: ${co} finished their intake form. Their client record is updated — review it and schedule production.`;
    const body     = [
      `A client completed their onboarding form.`,
      ``,
      `Client: ${co}`,
      `Email:  ${data.email || '—'}`,
      ``,
      `Their answers have been written onto the client record in the CRM.`,
    ].join('\n');
    return { chatText, subject: `🚀 Onboarding complete: ${co}`, body };
  }

  // One summary for an import (4+ deals in one insert) — see
  // 20261011190000_deal_import_alert_summary.sql. One alert per deal sent
  // 76 in two minutes on 2026-10-10.
  if (event === 'deals_imported') {
    const n     = Number(data.count) || 0;
    const shown = (data.names || '').split(', ').filter(Boolean);
    const more  = n > shown.length ? ` and ${n - shown.length} more` : '';
    const list  = shown.join(', ') || '—';
    const chatText = `${emoji} ${n} NEW DEALS imported: ${list}${more}. Check the pipeline.`;
    const body     = [
      `${n} deals were added to the pipeline in one import.`,
      ``,
      `First few: ${list}${more}`,
    ].join('\n');
    return { chatText, subject: `📋 ${n} new deals imported`, body };
  }

  // new_deal (manually added from CRM)
  const chatText = `${emoji} NEW DEAL: ${co}${data.stage ? ' → ' + data.stage : ''} stage. Check the pipeline.`;
  const body     = [
    `A new deal was added to the pipeline.`,
    ``,
    `Deal:    ${name}`,
    `Company: ${data.company || '—'}`,
    `Stage:   ${data.stage   || '—'}`,
    `Service: ${data.service || '—'}`,
  ].join('\n');
  return { chatText, subject: `📋 New pipeline deal: ${co}`, body };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400); }

  // Two legitimate callers:
  //   * DB triggers (new deal / public quote / tour booking) — they read the
  //     shared secret from Vault at call time and send it in the body. The
  //     Vault value is canonical; the env GL_NOTIFY_SECRET only counts while
  //     no Vault value exists, so rotating the Vault value retires the old
  //     secret that once shipped in the public page HTML.
  //   * The CRM in a staff session — no secret at all; the staff JWT is the
  //     authorization (requireStaff).
  const vaultSecret = await vaultGet('gl_notify_secret');
  const expectedSecret = vaultSecret || Deno.env.get('GL_NOTIFY_SECRET') || '';
  const secretOk = !!expectedSecret && payload.secret === expectedSecret;
  if (!secretOk) {
    const auth = await requireStaff(req);
    if (!auth.ok) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const event = String(payload.event || '');
  const data  = (payload.data || {}) as Record<string, string>;

  // Connect Telegram: remember the chat that pressed Start in the bot and
  // send it a test. Returns who it connected to.
  if (event === 'telegram_setup') {
    const tg = await setupTelegram();
    console.log('[notify-deal] telegram_setup →', tg.ok, tg.reply, tg.who || '');
    return jsonResponse({ ok: tg.ok, telegram: tg });
  }
  if (event === 'telegram_test') {
    const tg = await sendTelegram('notify-deal', '🔔 Good Liquid CRM test: Telegram alerts are working.');
    return jsonResponse({ ok: tg.ok, telegram: tg });
  }

  const { chatText, subject, body } = buildMessage(event, data);

  const tg = await sendTelegram('notify-deal', chatText);
  let   telegramSent = tg.ok;
  const mail         = await sendEmail(subject, body);
  const emailSent    = mail.ok;
  console.log('[notify-deal]', event, '→ telegram:', telegramSent, 'email:', emailSent);

  // Neither reliable channel took it: say so on Telegram straight away rather
  // than waiting for the morning heartbeat. A Telegram refusal is often
  // momentary (rate limit, network), so this is also a second Telegram try,
  // with the original alert text attached.
  let warned: boolean | null = null;
  if (!telegramSent && !emailSent) {
    console.error(`[notify-deal] ALERT REACHED NOBODY: ${event} — telegram: ${tg.reply} · email: ${mail.detail}`);
    await new Promise((r) => setTimeout(r, 2000));
    const w = await sendTelegram('notify-deal', deliveryFailureWarning(event, chatText, { telegram: tg.reply, email: mail.detail }));
    warned = w.ok;
    if (w.ok) telegramSent = true;
  }

  const errors = [
    tg.ok ? '' : `telegram: ${tg.reply}`,
    emailSent ? '' : `email: ${mail.detail}`,
  ].filter(Boolean).join(' | ');
  await logNotification({
    source: 'notify-deal', event,
    ok: telegramSent || emailSent,
    telegram_ok: tg.ok, email_ok: emailSent,
    error: errors || null,
    detail: { email_attempts: mail.attempts, failure_warning_sent: warned },
  });

  return jsonResponse({ ok: true, telegramSent, emailSent });
});
