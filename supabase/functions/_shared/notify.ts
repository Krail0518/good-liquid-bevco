// notifyDeal — one awaited, checked call from an edge function to notify-deal.
//
// Two problems this replaces (2026-10-12):
//   * booking-confirm fired its alert fire-and-forget (fetch not awaited), so
//     the request could be dropped when the worker exited after responding.
//   * It sent Deno.env GL_NOTIFY_SECRET. notify-deal accepts the Vault value
//     gl_notify_secret FIRST and only falls back to the env var while no Vault
//     value exists, so once the Vault secret was rotated the env value no
//     longer matched and the call was refused (401) without anyone seeing it.
//
// The secret is read from Vault first (same order as notify-deal and
// _shared/booking-token.ts). The call is awaited with a timeout and the result
// is returned, never thrown: an alert failure must not break the caller's own
// flow (a booking, a signature), but it is always logged.

import { vaultGet } from './gmail-creds.ts';

export type NotifyResult = { ok: boolean; status: number; detail: string };

export async function notifyDeal(
  source: string,
  event: string,
  data: Record<string, string>,
  timeoutMs = 25000,
): Promise<NotifyResult> {
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const secret = (await vaultGet('gl_notify_secret')) || Deno.env.get('GL_NOTIFY_SECRET') || '';
    if (!supaUrl || !serviceKey || !secret) {
      const detail = 'notify secret, service key or URL missing';
      console.error(`[${source}] ${event} alert NOT sent: ${detail}`);
      return { ok: false, status: 0, detail };
    }
    const r = await fetch(`${supaUrl}/functions/v1/notify-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ event, secret, data }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok || j.ok !== true) {
      const detail = `notify-deal answered ${r.status}${j.error ? ': ' + String(j.error) : ''}`;
      console.error(`[${source}] ${event} alert failed: ${detail}`);
      return { ok: false, status: r.status, detail };
    }
    const delivered = j.telegramSent === true || j.emailSent === true;
    if (!delivered) console.error(`[${source}] ${event} alert reached neither Telegram nor email`);
    return { ok: delivered, status: r.status, detail: `telegram: ${j.telegramSent} · email: ${j.emailSent}` };
  } catch (e) {
    const detail = String(e);
    console.error(`[${source}] ${event} alert threw: ${detail}`);
    return { ok: false, status: 0, detail };
  }
}
