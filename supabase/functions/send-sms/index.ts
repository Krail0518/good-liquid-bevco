// send-sms — sends a single SMS via Twilio.
// Used by the CRM's "SMS Alerts" feature to text clients about production
// milestones, overdue invoices, or anything else the admin chooses.
//
// Request body (POST JSON):
//   {
//     to:   string   // E.164 phone number, e.g. "+18135550100"
//     body: string   // message text (max 1600 chars, will be auto-segmented)
//   }
//
// Response:
//   { ok: true, sid: string }     on success
//   { error: string }             on failure
//
// Secrets required:
//   TWILIO_ACCOUNT_SID   — ACxxx…
//   TWILIO_AUTH_TOKEN    — paired with the SID
//   TWILIO_FROM          — your Twilio phone number in E.164, e.g. "+18135550199"
//
// Deploy:
//   supabase functions deploy send-sms
//   supabase secrets set TWILIO_ACCOUNT_SID=ACxxx
//   supabase secrets set TWILIO_AUTH_TOKEN=xxx
//   supabase secrets set TWILIO_FROM=+18135550199

import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const sid   = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from  = Deno.env.get('TWILIO_FROM');
  if (!sid || !token || !from) {
    return errorResponse('Twilio secrets not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)', 500);
  }

  let payload: Record<string, string>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const to = (payload.to || '').trim();
  const body = (payload.body || '').trim();
  if (!to)   return errorResponse('to is required', 400);
  if (!body) return errorResponse('body is required', 400);
  if (!/^\+\d{8,15}$/.test(to)) {
    return errorResponse('to must be E.164 format, e.g. "+18135550100"', 400);
  }

  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', from);
  form.set('Body', body);

  const auth = btoa(`${sid}:${token}`);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('[send-sms] Twilio error:', r.status, errText);
    return errorResponse('Twilio rejected the message', r.status, { twilio_error: errText });
  }

  const data = await r.json();
  return jsonResponse({ ok: true, sid: data.sid, status: data.status });
});
