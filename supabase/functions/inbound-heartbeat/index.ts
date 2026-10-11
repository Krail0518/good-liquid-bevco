// inbound-heartbeat — one Telegram message every morning that proves the
// inbound pipes are flowing, and says loudly when one is not.
//
// WHY
// The website quote form failed for every visitor from 2026-08-28 to
// 2026-10-11 and nothing said so; ~60 leads were missed. A broken alert path
// is silent by nature: no alert is exactly what "nothing happened" looks like.
// A daily message that ALWAYS arrives turns silence into a signal: if the
// morning check does not show up, something is wrong with Telegram itself.
//
// WHAT IT SENDS (plain text, short enough to read on a phone)
//   • Problems first, if any: the quote form dry-run probe failing, no website
//     quote in 7 days, Gmail sync not having worked in 2h, a primary alert
//     channel (Telegram, email) failing every send in 24h, a channel that used
//     to deliver going quiet for 3 days, alerts that reached nobody.
//   • Last-24h counts: website quotes, new deals, tour requests, onboarding
//     forms, portal requests, client/lead emails in, and per-channel delivery.
// Thresholds and wording: buildHeartbeat() in _shared/inbound-alarms.mjs,
// covered by tests/inbound-alarms.test.mjs.
//
// WHY AN EDGE FUNCTION AND NOT PURE SQL CRON
//   1. The quote-form probe must go through the real public path: PostgREST
//      as the anon role, exactly as a website visitor does. From SQL we could
//      only call the function as postgres, which is the path that did NOT
//      break in August (the failure was a permission check that only bit anon).
//   2. The Telegram bot token is read by _shared/telegram.ts (env or Vault);
//      net.http_post from SQL is fire-and-forget, so SQL could not tell whether
//      the heartbeat itself was delivered or fall back to email when it was not.
// The counting is still SQL (public.gl_inbound_heartbeat_stats, service_role
// only), so it can be verified directly in the database.
//
// Callers: pg_cron daily (x-cron-secret from Vault, see
// 20261012010000_inbound_alarms.sql), or a staff user / service role by hand.
// Body (optional): { "dry_run": true } builds and returns the message without
// sending it.
//
// Deploy: supabase functions deploy inbound-heartbeat (gateway verify_jwt on;
// the cron job sends the anon key as the bearer, like attention-digest).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { isCronCall } from '../_shared/cron-auth.ts';
import { requireStaff } from '../_shared/auth.ts';
import { sendTelegram } from '../_shared/telegram.ts';
import { sendAlertEmail, logNotification } from '../_shared/alert-delivery.ts';
import { buildHeartbeat } from '../_shared/inbound-alarms.mjs';

const MIKE_EMAILS = ['mike@goodliquid.com'];

// The same complete payload scripts/security-invariants.sh sends: it passes
// validation, runs the whole anonymous path (contact_submissions row, deal,
// deck dispatch, every trigger and its queued pg_net alert) and then raises
// DRY_RUN_OK, which rolls all of it back. Nothing is stored or sent.
const QUOTE_PROBE = {
  p: {
    dry_run: true, brand_name: 'Heartbeat probe', contact_name: 'Heartbeat Probe',
    email: 'heartbeat-probe@example.com', phone: '555-555-0199',
    details: 'Automated daily dry run of the public quote form.',
    service: 'Small batch canning', product_type: 'Seltzer',
  },
};

async function probeQuoteForm(): Promise<{ status: 'ok' | 'fail' | 'unverified'; detail: string }> {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return { status: 'unverified', detail: 'SUPABASE_ANON_KEY not available' };
  try {
    const r = await fetch(`${url}/rest/v1/rpc/submit_quote_request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify(QUOTE_PROBE),
    });
    const text = await r.text();
    if (text.includes('DRY_RUN_OK')) return { status: 'ok', detail: 'dry run completed' };
    // A gateway hiccup proves nothing either way; only a real answer from the
    // database counts as a failure.
    if (r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504) {
      return { status: 'unverified', detail: `gateway ${r.status}` };
    }
    let msg = text;
    try { const j = JSON.parse(text); msg = String(j.message || j.error || text); } catch { /* raw text */ }
    return { status: 'fail', detail: `${r.status} ${msg}`.slice(0, 300) };
  } catch (e) {
    return { status: 'unverified', detail: String(e).slice(0, 200) };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  if (!(await isCronCall(req))) {
    const auth = await requireStaff(req);
    if (!auth.ok) return errorResponse(auth.error || 'Unauthorized', auth.status);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* optional */ }
  const dryRun = body.dry_run === true;

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const [statsRes, probe] = await Promise.all([
    supa.rpc('gl_inbound_heartbeat_stats'),
    probeQuoteForm(),
  ]);

  let text: string;
  let problems: string[];
  if (statsRes.error || !statsRes.data) {
    // Still send something: a heartbeat that goes quiet because its own query
    // broke would be the very failure this function exists to prevent.
    const why = statsRes.error ? statsRes.error.message : 'no data';
    problems = [`Heartbeat could not read its counts: ${why}`];
    text = `🩺 Good Liquid daily check\n\n⚠️ The health check could not read its counts (${why}).\nQuote form test: ${probe.status}${probe.status === 'ok' ? '' : ' — ' + probe.detail}`;
  } else {
    ({ text, problems } = buildHeartbeat(statsRes.data, probe, Date.now()));
  }

  if (dryRun) return jsonResponse({ ok: true, dry_run: true, text, problems, probe });

  const tg = await sendTelegram('inbound-heartbeat', text);
  // Telegram is the channel being relied on; if it refuses, the heartbeat
  // goes by email so the morning check still arrives somewhere.
  let emailOk: boolean | null = null;
  let emailDetail = '';
  if (!tg.ok) {
    const m = await sendAlertEmail('inbound-heartbeat', MIKE_EMAILS,
      problems.length ? `⚠️ Daily check: ${problems.length} problem(s), and Telegram failed` : '🩺 Daily check (Telegram failed)',
      `${text}\n\nTelegram refused this message: ${tg.reply}`);
    emailOk = m.ok;
    emailDetail = m.detail;
  }

  await logNotification({
    source: 'inbound-heartbeat', event: 'daily_check',
    ok: tg.ok || emailOk === true,
    telegram_ok: tg.ok, email_ok: emailOk,
    error: [tg.ok ? '' : `telegram: ${tg.reply}`, emailOk === false ? `email: ${emailDetail}` : ''].filter(Boolean).join(' | ') || null,
    detail: { problems: problems.length, probe: probe.status },
  });

  return jsonResponse({ ok: tg.ok || emailOk === true, telegram: tg.ok, email: emailOk, problems });
});
