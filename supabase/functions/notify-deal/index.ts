// notify-deal — internal notification dispatcher for pipeline deals and tour bookings.
// Sends a WhatsApp message to Mike via CallMeBot and a Gmail notification email.
//
// Called from:
//   • booking-confirm  (tour booked via public book.html)
//   • index.html       (deal manually added in CRM, or tour booked via CRM widget)
//   • request-a-quote.html  (public quote request form)
//   • Supabase DB trigger on deals INSERT
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
//   CALLMEBOT_PHONE           — recipient phone number (digits only, no +), e.g. 18034935065
//   CALLMEBOT_API_KEY         — API key from CallMeBot WhatsApp activation
//   SUPABASE_URL              — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided
//
// Deploy:
//   supabase functions deploy notify-deal
//   supabase secrets set CALLMEBOT_PHONE=18034935065 CALLMEBOT_API_KEY=<key>

import { corsHeaders, jsonResponse, handlePreflight } from '../_shared/cors.ts';

const MIKE_EMAILS = ['mike@goodliquid.com'];
const EMOJI_MAP: Record<string, string> = {
  tour_booked:        '📅',
  new_deal:           '📋',
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
};

async function sendWhatsApp(message: string): Promise<boolean> {
  const phone  = Deno.env.get('CALLMEBOT_PHONE');
  const apiKey = Deno.env.get('CALLMEBOT_API_KEY');
  if (!phone || !apiKey) { console.error('[notify-deal] CALLMEBOT_PHONE or CALLMEBOT_API_KEY not set'); return false; }
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
    const r = await fetch(url);
    const text = await r.text();
    if (!r.ok || text.toLowerCase().includes('error')) {
      console.error('[notify-deal] CallMeBot error:', r.status, text);
      return false;
    }
    console.log('[notify-deal] WhatsApp sent ok');
    return true;
  } catch (e) {
    console.error('[notify-deal] WhatsApp error:', e);
    return false;
  }
}

async function sendEmail(subject: string, text: string): Promise<boolean> {
  const supaUrl    = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !serviceKey) { console.error('[notify-deal] missing SUPABASE_URL or SERVICE_ROLE_KEY'); return false; }
  try {
    const r = await fetch(`${supaUrl}/functions/v1/gmail-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ to: MIKE_EMAILS, subject, text }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('[notify-deal] gmail-send error:', r.status, JSON.stringify(body)); return false; }
    console.log('[notify-deal] email sent ok, id:', body.id);
    return true;
  } catch (e) {
    console.error('[notify-deal] email error:', e);
    return false;
  }
}

function buildMessage(event: string, data: Record<string, string>): { whatsapp: string; subject: string; body: string } {
  const emoji = EMOJI_MAP[event] || '🔔';
  const co    = data.company || data.name || 'Unknown';
  const name  = data.name || '';

  if (event === 'tour_booked') {
    const when     = data.date ? `${data.date} at ${data.time || ''}`.trim() : 'time TBD';
    const whatsapp = `${emoji} TOUR BOOKED: ${name}${data.company ? ' (' + data.company + ')' : ''} — ${when}. Email: ${data.email || 'n/a'}`;
    const body     = [
      `Tour booked via Good Liquid scheduling link.`,
      ``,
      `Name:    ${name}`,
      `Company: ${data.company || '—'}`,
      `Email:   ${data.email   || '—'}`,
      `Phone:   ${data.phone   || '—'}`,
      `When:    ${when}`,
    ].join('\n');
    return { whatsapp, subject: `📅 New tour: ${name} — ${when}`, body };
  }

  if (event === 'new_quote') {
    const whatsapp = `${emoji} NEW QUOTE REQUEST from ${co}${data.email ? ' (' + data.email + ')' : ''}. Service: ${data.service || 'TBD'}. Check the pipeline.`;
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
    return { whatsapp, subject: `📩 New quote: ${co}`, body };
  }

  if (event === 'invoice_paid_stripe' || event === 'invoice_paid_manual') {
    const amt      = data.amount ? ` — $${parseFloat(data.amount).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}` : '';
    const method   = event === 'invoice_paid_stripe' ? ' via Stripe' : ' (manual)';
    const whatsapp = `${emoji} INVOICE PAID${method}: ${data.invoice_number || '—'} · ${data.client || co}${amt}`;
    const body     = [
      `Invoice marked paid${method}.`,
      ``,
      `Invoice: ${data.invoice_number || '—'}`,
      `Client:  ${data.client || co}`,
      `Amount:  ${amt ? amt.trim() : '—'}`,
    ].join('\n');
    return { whatsapp, subject: `${emoji} Invoice paid: ${data.invoice_number || co}${amt}`, body };
  }

  if (event === 'invoice_paid_bulk') {
    const whatsapp = `${emoji} BULK PAYMENT: ${data.count || '?'} invoice${Number(data.count)===1?'':'s'} marked paid. Check the dashboard.`;
    const body     = `${data.count || '?'} invoice${Number(data.count)===1?'':'s'} marked paid in bulk.`;
    return { whatsapp, subject: `✅ ${data.count} invoices paid`, body };
  }

  if (event === 'deal_closed_won') {
    const val      = data.value ? ` · $${parseFloat(data.value).toLocaleString()}` : '';
    const whatsapp = `${emoji} CLOSED WON: ${co}${val}. 🎉 Check the pipeline.`;
    const body     = [
      `Deal moved to Closed Won.`,
      ``,
      `Deal:    ${name}`,
      `Company: ${data.company || '—'}`,
      `Value:   ${val ? val.trim() : '—'}`,
      `Email:   ${data.email || '—'}`,
      `Phone:   ${data.phone || '—'}`,
    ].join('\n');
    return { whatsapp, subject: `🏆 Closed Won: ${co}${val}`, body };
  }

  if (event === 'new_client') {
    const whatsapp = `${emoji} NEW CLIENT: ${co}${data.contact ? ' · ' + data.contact : ''}. Service: ${data.service || 'TBD'}. Source: ${data.lead_source || 'unknown'}.`;
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
    return { whatsapp, subject: `🤝 New client: ${co}`, body };
  }

  if (event === 'invoice_sent' || event === 'invoice_sent_bulk') {
    if (event === 'invoice_sent_bulk') {
      const whatsapp = `${emoji} BULK SEND: ${data.count} invoice${Number(data.count)===1?'':'s'} sent${data.failed && data.failed!=='0' ? ', ' + data.failed + ' failed' : ''}.`;
      const body     = `${data.count} invoice${Number(data.count)===1?'':'s'} sent via Mailgun bulk send.`;
      return { whatsapp, subject: `📤 ${data.count} invoices sent`, body };
    }
    const amt      = data.amount ? ` · $${parseFloat(data.amount).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}` : '';
    const whatsapp = `${emoji} INVOICE SENT: ${data.invoice_number || '—'} → ${data.client || co}${amt}. To: ${data.to || '—'}`;
    const body     = [
      `Invoice sent via Mailgun.`,
      ``,
      `Invoice: ${data.invoice_number || '—'}`,
      `Client:  ${data.client || co}`,
      `Amount:  ${amt ? amt.trim() : '—'}`,
      `To:      ${data.to || '—'}`,
    ].join('\n');
    return { whatsapp, subject: `📤 Invoice sent: ${data.invoice_number || co}`, body };
  }

  if (event === 'client_email_reply') {
    const preview  = data.body_preview ? '\n\n"' + data.body_preview.slice(0, 200) + (data.body_preview.length > 200 ? '…' : '') + '"' : '';
    const whatsapp = `${emoji} CLIENT REPLY: ${data.from_email || '—'} · "${data.subject || '(no subject)'}"`;
    const body     = [`Client replied to an email.`, ``, `From:    ${data.from_email || '—'}`, `Subject: ${data.subject || '—'}`, preview].join('\n');
    return { whatsapp, subject: `📬 Reply from ${data.from_email || 'client'}`, body };
  }

  if (event === 'new_referral') {
    const comm     = data.amount ? ` · $${parseFloat(data.amount).toLocaleString()} commission` : '';
    const whatsapp = `${emoji} NEW REFERRAL: ${data.company || '—'} referred ${name || '—'}${comm}.`;
    const body     = [
      `New referral logged.`,
      ``,
      `Referred by: ${data.company || '—'}`,
      `Client:      ${name || '—'}`,
      `Commission:  ${comm ? comm.replace(' · ', '') : '—'}`,
    ].join('\n');
    return { whatsapp, subject: `🌟 Referral: ${name} from ${data.company || '—'}`, body };
  }

  // new_deal (manually added from CRM)
  const whatsapp = `${emoji} NEW DEAL: ${co}${data.stage ? ' → ' + data.stage : ''} stage. Check the pipeline.`;
  const body     = [
    `A new deal was added to the pipeline.`,
    ``,
    `Deal:    ${name}`,
    `Company: ${data.company || '—'}`,
    `Stage:   ${data.stage   || '—'}`,
    `Service: ${data.service || '—'}`,
  ].join('\n');
  return { whatsapp, subject: `📋 New pipeline deal: ${co}`, body };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400); }

  const expectedSecret = Deno.env.get('GL_NOTIFY_SECRET');
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const event = String(payload.event || '');
  const data  = (payload.data || {}) as Record<string, string>;

  const { whatsapp, subject, body } = buildMessage(event, data);

  const whatsappSent = await sendWhatsApp(whatsapp);
  const emailSent    = await sendEmail(subject, body);
  console.log('[notify-deal]', event, '→ whatsapp:', whatsappSent, 'email:', emailSent);

  return jsonResponse({ ok: true, whatsappSent, emailSent });
});
