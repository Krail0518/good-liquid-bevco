// Alert delivery helpers shared by notify-deal, gmail-sync and inbound-heartbeat.
//
//   sendAlertEmail   gmail-send with a retry. On 2026-10-11 a burst of alerts
//                    hit Gmail's 429 "Too many concurrent requests for user"
//                    and notify-deal dropped those emails on the first try.
//                    Now 429 / 5xx / network errors are retried after 1s and
//                    3s, and the final failure is logged with its status.
//   logNotification  one row in public.notification_log (server-only table,
//                    RLS on with no policies) per delivery attempt, so the
//                    morning heartbeat can say whether alerts actually arrived.
//                    Logging is best effort: it never throws and never blocks
//                    the alert itself.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { withRetry } from './inbound-alarms.mjs';

export interface EmailResult { ok: boolean; status: number; detail: string; attempts: number }

export async function sendAlertEmail(
  tag: string, to: string[], subject: string, text: string, html?: string,
): Promise<EmailResult> {
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !serviceKey) {
    console.error(`[${tag}] EMAIL ALERT NOT SENT: missing SUPABASE_URL or SERVICE_ROLE_KEY`);
    return { ok: false, status: 0, detail: 'missing SUPABASE_URL or SERVICE_ROLE_KEY', attempts: 0 };
  }
  const res = await withRetry(async (n: number) => {
    const r = await fetch(`${supaUrl}/functions/v1/gmail-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify(html ? { to, subject, text, html } : { to, subject, text }),
    });
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (r.ok) return { ok: true, status: r.status, detail: String(body.id || 'sent') };
    const detail = `${r.status} ${JSON.stringify(body).slice(0, 300)}`;
    console.warn(`[${tag}] gmail-send attempt ${n} failed: ${detail}`);
    return { ok: false, status: r.status, detail };
  }, [1000, 3000]) as EmailResult;
  if (res.ok) console.log(`[${tag}] email sent ok after ${res.attempts} attempt(s), id: ${res.detail}`);
  else console.error(`[${tag}] EMAIL ALERT LOST after ${res.attempts} attempt(s): ${res.detail} — subject: ${subject.slice(0, 120)}`);
  return res;
}

export interface NotificationRow {
  source: string;
  event: string;
  ok: boolean;
  whatsapp_ok?: boolean | null;
  telegram_ok?: boolean | null;
  email_ok?: boolean | null;
  error?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function logNotification(row: NotificationRow): Promise<boolean> {
  try {
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const { data, error } = await supa.from('notification_log').insert({
      source: row.source,
      event: row.event.slice(0, 80),
      ok: row.ok,
      whatsapp_ok: row.whatsapp_ok ?? null,
      telegram_ok: row.telegram_ok ?? null,
      email_ok: row.email_ok ?? null,
      error: row.error ? row.error.slice(0, 1000) : null,
      detail: row.detail ?? null,
    }).select('id');
    if (error || !data || !data.length) {
      console.error(`[${row.source}] notification_log insert failed:`, error ? error.message : 'no row written');
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[${row.source}] notification_log insert error:`, e);
    return false;
  }
}
