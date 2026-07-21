// notify-deal — internal notification dispatcher for pipeline deals and tour bookings.
// Sends an SMS to Mike (+18034935065) via the send-sms edge function, with a Mailgun
// email to mike@goodliquid.com as backup.
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
//   SUPABASE_URL              — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided
//   MAILGUN_API_KEY           — for email fallback
//   MAILGUN_DOMAIN
//   MAILGUN_FROM
//
// Deploy:
//   supabase functions deploy notify-deal
//   supabase secrets set GL_NOTIFY_SECRET=<your-secret>

import { corsHeaders, jsonResponse, handlePreflight } from '../_shared/cors.ts';

const MIKE_PHONE  = '+18034935065';
const MIKE_EMAIL  = 'mike@goodliquid.com';
const EMOJI_MAP   = { tour_booked: '📅', new_deal: '📋', new_quote: '📩' } as Record<string, string>;

async function sendSMS(body: string): Promise<boolean> {
  const supaUrl    = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !serviceKey) return false;
  try {
    const r = await fetch(`${supaUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ to: MIKE_PHONE, body }),
    });
    return r.ok;
  } catch (e) {
    console.error('[notify-deal] SMS error:', e);
    return false;
  }
}

async function sendEmail(subject: string, text: string): Promise<void> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from   = Deno.env.get('MAILGUN_FROM') || 'Good Liquid Alerts <noreply@goodliquidbevco.com>';
  if (!apiKey || !domain) return;
  try {
    const form = new FormData();
    form.set('from', from);
    form.set('to', MIKE_EMAIL);
    form.set('subject', subject);
    form.set('text', text);
    await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa('api:' + apiKey) },
      body: form,
    });
  } catch (e) {
    console.error('[notify-deal] email fallback error:', e);
  }
}

function buildMessage(event: string, data: Record<string, string>): { sms: string; subject: string; body: string } {
  const emoji = EMOJI_MAP[event] || '🔔';
  const co    = data.company || data.name || 'Unknown';
  const name  = data.name || '';

  if (event === 'tour_booked') {
    const when  = data.date ? `${data.date} at ${data.time || ''}`.trim() : 'time TBD';
    const sms   = `${emoji} TOUR BOOKED: ${name}${data.company ? ' (' + data.company + ')' : ''} — ${when}. Email: ${data.email || 'n/a'}`;
    const body  = [
      `Tour booked via Good Liquid scheduling link.`,
      ``,
      `Name:    ${name}`,
      `Company: ${data.company || '—'}`,
      `Email:   ${data.email   || '—'}`,
      `Phone:   ${data.phone   || '—'}`,
      `When:    ${when}`,
    ].join('\n');
    return { sms, subject: `📅 New tour: ${name} — ${when}`, body };
  }

  if (event === 'new_quote') {
    const sms  = `${emoji} NEW QUOTE REQUEST from ${co}${data.email ? ' (' + data.email + ')' : ''}. Service: ${data.service || 'TBD'}. Check the pipeline.`;
    const body = [
      `New quote request submitted via goodliquidbevco.com.`,
      ``,
      `Brand:   ${co}`,
      `Contact: ${name}`,
      `Email:   ${data.email   || '—'}`,
      `Phone:   ${data.phone   || '—'}`,
      `Service: ${data.service || '—'}`,
      `Volume:  ${data.volume  || '—'}`,
    ].join('\n');
    return { sms, subject: `📩 New quote: ${co}`, body };
  }

  // new_deal (manually added from CRM)
  const sms  = `${emoji} NEW DEAL: ${co}${data.stage ? ' → ' + data.stage : ''} stage. Check the pipeline.`;
  const body = [
    `A new deal was added to the pipeline.`,
    ``,
    `Deal:    ${name}`,
    `Company: ${data.company || '—'}`,
    `Stage:   ${data.stage   || '—'}`,
    `Service: ${data.service || '—'}`,
  ].join('\n');
  return { sms, subject: `📋 New pipeline deal: ${co}`, body };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400); }

  // Validate shared secret
  const expectedSecret = Deno.env.get('GL_NOTIFY_SECRET');
  if (!expectedSecret || payload.secret !== expectedSecret) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const event = String(payload.event || '');
  const data  = (payload.data || {}) as Record<string, string>;

  const { sms, subject, body } = buildMessage(event, data);

  // Send SMS (primary); if it fails, send email (backup)
  const smsSent = await sendSMS(sms);
  if (!smsSent) {
    await sendEmail(subject, body);
  }

  // Always send email too for a paper trail
  sendEmail(subject, body).catch(() => {});

  return jsonResponse({ ok: true, smsSent });
});
