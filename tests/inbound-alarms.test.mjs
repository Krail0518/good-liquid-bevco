/*
 * inbound-alarms.test.mjs — "Mike can never again silently miss an inbound
 * customer message."
 *
 * From 2026-08-28 to 2026-10-11 every website quote request failed and nothing
 * said so. The audit found three more silent holes: portal requests had no
 * alert, client email replies imported by gmail-sync had none, and alert
 * emails that hit Gmail's 429 were dropped. This file covers the logic that
 * closes them, importing THE SAME module the edge functions run
 * (supabase/functions/_shared/inbound-alarms.mjs), plus static checks that the
 * functions and the migration are wired to it.
 *
 * The SQL (trigger, stats function, privileges, cron) was verified against
 * production inside a rolled-back transaction; see the PR description.
 *
 * Run: node tests/inbound-alarms.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  portalRequestMessage, clientReplyMessage, clientRepliesSummary, deliveryFailureWarning,
  selectReplyAlerts, isRetryableStatus, withRetry, heartbeatProblems, buildHeartbeat,
} from '../supabase/functions/_shared/inbound-alarms.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

const NOW = Date.parse('2026-10-12T11:30:00Z');
const H = 3600000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();

console.log('inbound alarms\n');

// ── Portal request messages ────────────────────────────────────────────────
{
  const m = portalRequestMessage({ client: 'Acme Seltzer', kind: 'reorder', subject: 'Need 40 more cases', body: 'x'.repeat(500) });
  ok('portal: names the client, type and subject', /Acme Seltzer/.test(m.short) && /REORDER/.test(m.short) && /Need 40 more cases/.test(m.short));
  const preview = m.short.split('\n')[1] || '';
  ok('portal: body preview is clipped to ~200 chars', preview.length <= 200 && preview.endsWith('…'), 'got ' + preview.length);
  ok('portal: email subject names the client', /Acme Seltzer/.test(m.subject));
  const s = portalRequestMessage({ count: '7', names: 'Acme, Bolt' });
  ok('portal: 4+ in one insert is one summary with the count', /7 PORTAL REQUESTS/.test(s.short) && /Acme, Bolt/.test(s.short));
  const e = portalRequestMessage({});
  ok('portal: empty data still produces a sensible alert', /A portal customer/.test(e.short) && /\(no subject\)/.test(e.short));
}

// ── Reply messages ─────────────────────────────────────────────────────────
{
  const m = clientReplyMessage({ from_email: 'jo@acme.com', subject: 'Re: quote', body_preview: 'Looks good, go ahead', client: 'Acme', kind: 'client' });
  ok('reply: client reply names who and what', /CLIENT REPLY · Acme/.test(m.short) && /jo@acme\.com/.test(m.short) && /Looks good/.test(m.short));
  const l = clientReplyMessage({ from_email: 'new@bolt.co', subject: 'hi', kind: 'lead' });
  ok('reply: lead reply is labelled as a lead', /LEAD REPLY/.test(l.short));
  ok('reply: no blank "Who" line when the name is unknown', !/Who:/.test(l.body));
  const s = clientRepliesSummary({ count: '12', lines: Array.from({ length: 12 }, (_, i) => `Client ${i} — subj`).join('\n') });
  ok('reply summary: count, first 8, and "more"', /12 new client\/lead emails/.test(s.short) && /Client 7/.test(s.short) && !/Client 8 /.test(s.short) && /4 more/.test(s.short));
}

// ── Which synced emails alert ──────────────────────────────────────────────
{
  const row = (o) => ({ direction: 'inbound', from_email: 'jo@acme.com', subject: 'Re: quote', sent_at: iso(NOW - H), ...o });
  ok('select: one fresh inbound reply alerts individually', selectReplyAlerts([row()], NOW).mode === 'each');
  ok('select: outbound mail never alerts', selectReplyAlerts([row({ direction: 'outbound' })], NOW).mode === 'none');
  ok('select: mail from goodliquid.com never alerts', selectReplyAlerts([row({ from_email: 'mike@goodliquid.com' })], NOW).mode === 'none');
  ok('select: mail from goodliquidbevco.com never alerts', selectReplyAlerts([row({ from_email: 'x@GoodLiquidBevCo.com' })], NOW).mode === 'none');
  ok('select: a backfilled 3-week-old message does not alert', selectReplyAlerts([row({ sent_at: iso(NOW - 21 * D) })], NOW).mode === 'none');
  ok('select: out-of-office auto replies do not alert', selectReplyAlerts([row({ subject: 'Automatic reply: Re: quote' }), row({ subject: 'Out of Office' })], NOW).mode === 'none');
  ok('select: 3 replies → 3 individual alerts', (() => { const r = selectReplyAlerts([row(), row(), row()], NOW); return r.mode === 'each' && r.items.length === 3; })());
  ok('select: 4+ replies → one summary', selectReplyAlerts([row(), row(), row(), row()], NOW).mode === 'summary');
  ok('select: empty input → none', selectReplyAlerts([], NOW).mode === 'none' && selectReplyAlerts(null, NOW).mode === 'none');
}

// ── gmail-send retry policy ────────────────────────────────────────────────
{
  ok('retry: 429 is retryable', isRetryableStatus(429));
  ok('retry: 500/503 are retryable', isRetryableStatus(500) && isRetryableStatus(503));
  ok('retry: network error (0) is retryable', isRetryableStatus(0));
  ok('retry: 400/401/403 are not', !isRetryableStatus(400) && !isRetryableStatus(401) && !isRetryableStatus(403));

  const naps = [];
  const sleep = async (ms) => { naps.push(ms); };
  let calls = 0;
  const r1 = await withRetry(async () => { calls++; return calls < 3 ? { ok: false, status: 429, detail: 'busy' } : { ok: true, status: 200, detail: 'id1' }; }, [1000, 3000], sleep);
  ok('retry: 429, 429, then success → delivered on attempt 3', r1.ok && r1.attempts === 3 && calls === 3);
  ok('retry: waits 1s then 3s', naps.join(',') === '1000,3000', naps.join(','));

  calls = 0; naps.length = 0;
  const r2 = await withRetry(async () => { calls++; return { ok: false, status: 429, detail: 'busy' }; }, [1000, 3000], sleep);
  ok('retry: gives up after 3 attempts and reports the last error', !r2.ok && r2.attempts === 3 && r2.detail === 'busy');

  calls = 0;
  const r3 = await withRetry(async () => { calls++; return { ok: false, status: 400, detail: 'bad' }; }, [1000, 3000], sleep);
  ok('retry: a 400 is not retried', !r3.ok && calls === 1);

  calls = 0;
  const r4 = await withRetry(async () => { calls++; if (calls === 1) throw new Error('ECONNRESET'); return { ok: true, status: 200, detail: 'x' }; }, [1, 1], sleep);
  ok('retry: a thrown network error is retried', r4.ok && calls === 2);
}

// ── Immediate failure warning ──────────────────────────────────────────────
{
  const w = deliveryFailureWarning('new_quote', '📩 NEW QUOTE REQUEST from Acme', { telegram: '502 Bad Gateway', email: '429 busy' });
  ok('warning: says delivery failed, names the event and both errors, carries the alert',
    /ALERT DELIVERY FAILED \(new_quote\)/.test(w) && /502/.test(w) && /429/.test(w) && /NEW QUOTE REQUEST from Acme/.test(w));
}

// ── Heartbeat ──────────────────────────────────────────────────────────────
const healthy = {
  quotes_24h: 2, last_quote_at: iso(NOW - 3 * H), deals_24h: 3, tours_24h: 1, tours_pending: 1,
  onboarding_24h: 0, portal_requests_24h: 1, portal_requests_open: 2,
  inbound_emails_24h: 9, inbound_client_emails_24h: 4, alerts_24h: 6, alerts_undelivered_24h: 0,
  gmail_sync: { last_ok_at: iso(NOW - 30 * 60000), last_error: null, last_error_at: null },
  channels: {
    telegram: { attempts_24h: 6, ok_24h: 6, ok_30d: true, last_ok_at: iso(NOW - H), attempts_since_ok: 0 },
    email:    { attempts_24h: 6, ok_24h: 5, ok_30d: true, last_ok_at: iso(NOW - H), attempts_since_ok: 0 },
    whatsapp: { attempts_24h: 6, ok_24h: 0, ok_30d: false, last_ok_at: null, attempts_since_ok: 6, last_error: '0 messages left' },
  },
};
const probeOk = { status: 'ok', detail: 'dry run completed' };
{
  const hb = buildHeartbeat(healthy, probeOk, NOW);
  ok('heartbeat: healthy day has no problems', hb.problems.length === 0, hb.problems.join(' / '));
  ok('heartbeat: says everything is flowing', /Everything is flowing/.test(hb.text));
  ok('heartbeat: lists every inbound count', ['Website quotes: 2', 'New deals: 3', 'Tour requests: 1 (1 awaiting approval)', 'Onboarding forms: 0',
    'Portal requests: 1 (2 open)', 'Client/lead emails in: 9 (4 from clients)'].every((s) => hb.text.includes(s)), hb.text);
  ok('heartbeat: shows per-channel delivery', /Telegram 6\/6/.test(hb.text) && /Email 5\/6/.test(hb.text) && /WhatsApp 0\/6/.test(hb.text));
  ok('heartbeat: a dead WhatsApp that never worked is shown, not flagged daily', !hb.problems.some((p) => /WhatsApp/.test(p)));
  ok('heartbeat: short enough for a phone (< 1200 chars, < 25 lines)', hb.text.length < 1200 && hb.text.split('\n').length < 25, hb.text.length + ' chars');
  ok('heartbeat: dated in Eastern time', /Mon, Oct 12/.test(hb.text), hb.text.split('\n')[0]);

  const has = (stats, probe, re) => heartbeatProblems(stats, probe, NOW).some((p) => re.test(p));
  ok('flag: the quote form probe failing', has(healthy, { status: 'fail', detail: '42501 Not authorized to send quote decks' }, /quote form is BROKEN.*42501/));
  ok('flag: the quote form probe unreachable', has(healthy, { status: 'unverified', detail: 'gateway 504' }, /Could not test the quote form/));
  ok('flag: no website quote in 8 days', has({ ...healthy, last_quote_at: iso(NOW - 8 * D) }, probeOk, /No website quote in 8 days/));
  ok('no flag: last quote 6 days ago', !has({ ...healthy, last_quote_at: iso(NOW - 6 * D) }, probeOk, /No website quote/));
  ok('flag: Gmail sync not working for 3h', has({ ...healthy, gmail_sync: { last_ok_at: iso(NOW - 3 * H) } }, probeOk, /Gmail sync last worked 3h ago/));
  ok('flag: Gmail sync never recorded', has({ ...healthy, gmail_sync: {} }, probeOk, /Gmail sync: no successful run/));
  ok('flag: Gmail sync error newer than its last success',
    has({ ...healthy, gmail_sync: { last_ok_at: iso(NOW - 90 * 60000), last_error: 'Gmail list failed 401', last_error_at: iso(NOW - 30 * 60000) } }, probeOk, /Gmail sync error: Gmail list failed 401/));
  ok('flag: Telegram failing every send in 24h',
    has({ ...healthy, channels: { ...healthy.channels, telegram: { attempts_24h: 4, ok_24h: 0, ok_30d: true, last_error: '403 bot blocked' } } }, probeOk, /Telegram: all 4 alerts failed.*403/));
  ok('flag: email failing every send even with no history (primary channel)',
    has({ ...healthy, channels: { ...healthy.channels, email: { attempts_24h: 2, ok_24h: 0, ok_30d: false } } }, probeOk, /Email: all 2 alerts failed/));
  ok('flag: WhatsApp failing all sends when it used to work',
    has({ ...healthy, channels: { ...healthy.channels, whatsapp: { attempts_24h: 3, ok_24h: 0, ok_30d: true } } }, probeOk, /WhatsApp: all 3/));
  ok('flag: a channel that used to deliver has gone quiet for 4 days',
    has({ ...healthy, channels: { ...healthy.channels, email: { attempts_24h: 0, ok_24h: 0, ok_30d: true, last_ok_at: iso(NOW - 4 * D), attempts_since_ok: 5 } } }, probeOk, /Email has not delivered since 4d ago/));
  ok('no flag: a quiet channel that simply had nothing to send',
    !has({ ...healthy, channels: { ...healthy.channels, email: { attempts_24h: 0, ok_24h: 0, ok_30d: true, last_ok_at: iso(NOW - 4 * D), attempts_since_ok: 0 } } }, probeOk, /Email/));
  ok('flag: alerts that reached nobody', has({ ...healthy, alerts_undelivered_24h: 2 }, probeOk, /2 alerts reached neither Telegram nor email/));

  const bad = buildHeartbeat({ ...healthy, alerts_undelivered_24h: 1 }, { status: 'fail', detail: 'x' }, NOW);
  ok('heartbeat: problems are listed FIRST, above the counts', bad.text.indexOf('⚠️ 2 problems') < bad.text.indexOf('Last 24h'));
  ok('heartbeat: missing stats do not crash', typeof buildHeartbeat({}, null, NOW).text === 'string');
}

// ── Wiring (static) ────────────────────────────────────────────────────────
{
  const notify = read('supabase/functions/notify-deal/index.ts');
  ok('notify-deal: email goes through the retrying sender', /sendAlertEmail\('notify-deal'/.test(notify) && !/fetch\(`\$\{supaUrl\}\/functions\/v1\/gmail-send`/.test(notify));
  ok('notify-deal: warns on Telegram when Telegram AND email both failed', /if \(!telegramSent && !emailSent\)[\s\S]{0,400}deliveryFailureWarning/.test(notify));
  ok('notify-deal: every dispatch is logged', /logNotification\(\{\s*source: 'notify-deal'/.test(notify));
  ok('notify-deal: handles portal_request and client_email_replies', /event === 'portal_request'/.test(notify) && /event === 'client_email_replies'/.test(notify));

  const sync = read('supabase/functions/gmail-sync/index.ts');
  ok('gmail-sync: alerts only on rows THIS run inserted', /insertedRows\.push\(\.\.\.batch\)/.test(sync) && /alertReplies\(insertedRows/.test(sync));
  ok('gmail-sync: records each full run for the heartbeat', /recordRun\(insertFailures === 0/.test(sync) && /if \(!isOnly\) await recordRun\(false/.test(sync));

  const hb = read('supabase/functions/inbound-heartbeat/index.ts');
  ok('heartbeat fn: cron secret or staff only', /isCronCall\(req\)[\s\S]{0,120}requireStaff\(req\)/.test(hb));
  ok('heartbeat fn: probes the quote form as anon, with dry_run', /rest\/v1\/rpc\/submit_quote_request/.test(hb) && /dry_run: true/.test(hb) && /SUPABASE_ANON_KEY/.test(hb));
  ok('heartbeat fn: falls back to email when Telegram refuses', /if \(!tg\.ok\)[\s\S]{0,200}sendAlertEmail/.test(hb));

  const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /_inbound_alarms\.sql$/.test(f));
  ok('migration exists', files.length === 1);
  const sql = files.length ? read('supabase/migrations/' + files[0]) : '';
  ok('migration: ROLLBACK note at the top', /^[\s\S]{0,400}ROLLBACK:/.test(sql));
  ok('migration: notification_log has RLS on', /alter table public\.notification_log enable row level security/.test(sql));
  ok('migration: notification_log has NO policies', !/create policy[^;]*notification_log/i.test(sql));
  ok('migration: notification_log revoked from anon/authenticated', /revoke all on table public\.notification_log from public, anon, authenticated/.test(sql));
  for (const fn of ['trigger_notify_customer_requests', 'gl_inbound_heartbeat_stats']) {
    ok(`migration: ${fn} is SECURITY DEFINER with a pinned search_path`,
      new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]{0,120}security definer\\s+set search_path = public, pg_temp`).test(sql));
    ok(`migration: ${fn} not executable by anon/authenticated`,
      new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated`).test(sql));
  }
  ok('migration: portal trigger is per statement', /on public\.customer_requests\s+referencing new table as new_rows\s+for each statement/.test(sql));
  ok('migration: portal alerts are rate limited per client', /continue when v_recent > 5/.test(sql));
  ok('migration: heartbeat cron sends the anon bearer and the Vault cron secret',
    /'inbound-heartbeat'[\s\S]{0,900}'Authorization', 'Bearer eyJ[\s\S]{0,400}'x-cron-secret', \(select decrypted_secret from vault\.decrypted_secrets where name = 'gl_cron_secret'\)/.test(sql));
  ok('migration: no USING (true)', !/using\s*\(\s*true\s*\)/i.test(sql));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
