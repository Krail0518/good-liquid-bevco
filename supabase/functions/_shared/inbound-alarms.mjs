/*
 * inbound-alarms.mjs — the pure logic behind "Mike can never again silently
 * miss an inbound customer message".
 *
 * WHY THIS EXISTS
 * From 2026-08-28 to 2026-10-11 every website quote request failed and nothing
 * said so: ~60 leads reached nobody. At the same time portal requests had no
 * alert at all, client email replies were imported by gmail-sync without one,
 * and an alert email that hit Gmail's 429 was dropped without a retry. Each
 * hole was silent because nothing ever checked that the pipes were flowing.
 *
 * This module holds the parts that decide WHAT to say and WHEN something is
 * wrong, so tests/inbound-alarms.test.mjs exercises the same code the edge
 * functions run (notify-deal, gmail-sync, inbound-heartbeat):
 *
 *   portalRequestMessage / clientReplyMessage / clientRepliesSummary
 *   deliveryFailureWarning      the immediate "an alert reached nobody" text
 *   selectReplyAlerts           which freshly synced emails deserve an alert
 *   isRetryableStatus/withRetry the gmail-send retry policy
 *   heartbeatProblems/buildHeartbeat  the daily Telegram health message
 *
 * Plain ESM, no imports, no I/O, so Deno and Node can both load it unchanged.
 * Every message is PLAIN TEXT (Telegram is sent without parse_mode, email as
 * text/plain), so customer-typed content cannot inject markup anywhere.
 */

// Good Liquid's own domains: mail from these is us, never a customer.
export const OWN_DOMAINS = ['goodliquid.com', 'goodliquidbevco.com'];

const HOUR = 3600000;
const DAY = 24 * HOUR;

function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// ── Portal requests ─────────────────────────────────────────────────────────
const KIND_LABEL = {
  sample: 'Sample request', reorder: 'Reorder', quote: 'Quote request',
  question: 'Question', other: 'Request',
};

// data: { client, kind, subject, body, count?, names? }
// count > 1 means the trigger summarised several requests from one insert.
export function portalRequestMessage(data) {
  const d = data || {};
  const n = Number(d.count) || 1;
  if (n > 1) {
    const list = clip(d.names || '', 300) || '—';
    const short = `🙋 ${n} PORTAL REQUESTS at once from: ${list}. Open the CRM Requests list.`;
    const body = [
      `${n} customer portal requests arrived in one batch.`,
      ``,
      `From: ${list}`,
      ``,
      `Open the CRM to read and answer them.`,
    ].join('\n');
    return { short, subject: `🙋 ${n} portal requests`, body };
  }
  const client = clip(d.client, 120) || 'A portal customer';
  const kind = KIND_LABEL[String(d.kind || '').toLowerCase()] || clip(d.kind, 40) || 'Request';
  const subj = clip(d.subject, 150) || '(no subject)';
  const preview = clip(d.body, 200);
  const short = `🙋 PORTAL ${kind.toUpperCase()} from ${client}: "${subj}"` + (preview ? `\n${preview}` : '');
  const body = [
    `A client sent a request through the customer portal.`,
    ``,
    `Client:  ${client}`,
    `Type:    ${kind}`,
    `Subject: ${subj}`,
    ``,
    preview || '(no message text)',
    ``,
    `Open the CRM to answer it.`,
  ].join('\n');
  return { short, subject: `🙋 Portal ${kind.toLowerCase()}: ${client}`, body };
}

// ── Client / lead email replies ─────────────────────────────────────────────
// data: { from_email, subject, body_preview, client?, kind? ('client'|'lead') }
export function clientReplyMessage(data) {
  const d = data || {};
  const from = clip(d.from_email, 120) || '—';
  const who = clip(d.client, 120);
  const label = d.kind === 'lead' ? 'LEAD REPLY' : 'CLIENT REPLY';
  const subj = clip(d.subject, 150) || '(no subject)';
  const preview = clip(d.body_preview, 200);
  const short = `📬 ${label}${who ? ' · ' + who : ''} (${from}): "${subj}"` + (preview ? `\n${preview}` : '');
  const body = [
    `${d.kind === 'lead' ? 'A lead' : 'A client'} emailed you.`,
    ``,
    who ? `Who:     ${who}` : null,
    `From:    ${from}`,
    `Subject: ${subj}`,
    ``,
    preview || '(no text)',
  ].filter((l) => l !== null).join('\n');
  return { short, subject: `📬 Reply from ${who || from}`, body };
}

// data: { count, lines } — lines is "who — subject" joined by newlines.
export function clientRepliesSummary(data) {
  const d = data || {};
  const n = Number(d.count) || 0;
  const lines = String(d.lines || '').split('\n').filter(Boolean).slice(0, 8).map((l) => '• ' + clip(l, 120));
  const more = n > lines.length ? `\n…and ${n - lines.length} more` : '';
  const short = `📬 ${n} new client/lead emails:\n${lines.join('\n')}${more}`;
  const body = [`${n} client or lead emails arrived since the last sync.`, ``, ...lines].join('\n') + more;
  return { short, subject: `📬 ${n} new client/lead emails`, body };
}

// Sent straight to Telegram when an alert reached neither Telegram nor email.
export function deliveryFailureWarning(event, shortText, results) {
  const r = results || {};
  const why = [
    r.telegram ? `Telegram: ${clip(r.telegram, 80)}` : '',
    r.email ? `Email: ${clip(r.email, 80)}` : '',
  ].filter(Boolean).join(' · ');
  return `⚠️ ALERT DELIVERY FAILED (${event})${why ? ' — ' + why : ''}\n\n${clip(shortText, 1500)}`;
}

// ── Which synced emails deserve an alert ────────────────────────────────────
const AUTO_REPLY = /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|undeliverable|delivery status notification)\b/i;

// rows: freshly INSERTED email_log rows (never ones that were already there).
// Returns { mode: 'none' | 'each' | 'summary', items }.
export function selectReplyAlerts(rows, nowMs, opts) {
  const o = opts || {};
  const maxAgeMs = (o.maxAgeDays == null ? 7 : o.maxAgeDays) * DAY;
  const each = o.maxIndividual == null ? 3 : o.maxIndividual;
  const items = (rows || []).filter((r) => {
    if (!r || r.direction !== 'inbound') return false;
    const from = String(r.from_email || '').toLowerCase().trim();
    const dom = from.split('@')[1] || '';
    if (!from || !dom || OWN_DOMAINS.includes(dom)) return false;
    // A backfill (an on-demand 30-day sync) is not news.
    const at = Date.parse(r.sent_at || '');
    if (Number.isFinite(at) && nowMs - at > maxAgeMs) return false;
    if (AUTO_REPLY.test(String(r.subject || ''))) return false;
    return true;
  });
  if (!items.length) return { mode: 'none', items };
  return { mode: items.length > each ? 'summary' : 'each', items };
}

// ── gmail-send retry ────────────────────────────────────────────────────────
// 429 ("Too many concurrent requests for user") and 5xx are transient; status
// 0 is a network error. Anything else (400, 401, 403) will fail the same way
// again, so retrying would only delay the failure log.
export function isRetryableStatus(status) {
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}

// attempt() returns { ok, status, detail }. Retries after each delay in turn.
export async function withRetry(attempt, delaysMs, sleep) {
  const waits = delaysMs || [1000, 3000];
  const nap = sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  let last = { ok: false, status: 0, detail: 'not attempted' };
  for (let i = 0; i <= waits.length; i++) {
    try { last = await attempt(i + 1); }
    catch (e) { last = { ok: false, status: 0, detail: String(e) }; }
    last.attempts = i + 1;
    if (last.ok || !isRetryableStatus(last.status) || i === waits.length) return last;
    await nap(waits[i]);
  }
  return last;
}

// ── Daily heartbeat ─────────────────────────────────────────────────────────
export const THRESHOLDS = {
  gmailSyncMaxAgeHours: 2,   // the sync runs hourly
  quoteQuietDays: 7,         // ~60 leads in 44 days: a week of silence is wrong
  channelStaleDays: 3,
};

function ago(iso, nowMs) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'never';
  const ms = Math.max(0, nowMs - t);
  if (ms < HOUR) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)}h ago`;
  return `${Math.round(ms / DAY)}d ago`;
}

const CHANNELS = [
  ['telegram', 'Telegram', true],
  ['email', 'Email', true],
  ['whatsapp', 'WhatsApp', false],  // CallMeBot: secondary, often out of quota
];

// stats: the jsonb from public.gl_inbound_heartbeat_stats().
// probe: { status: 'ok' | 'fail' | 'unverified', detail }.
export function heartbeatProblems(stats, probe, nowMs) {
  const s = stats || {};
  const p = [];
  const t = THRESHOLDS;

  if (probe && probe.status === 'fail') p.push(`Website quote form is BROKEN: ${clip(probe.detail, 160)}`);
  else if (probe && probe.status === 'unverified') p.push(`Could not test the quote form (${clip(probe.detail, 120)})`);

  const lastQuote = Date.parse(s.last_quote_at || '');
  if (!Number.isFinite(lastQuote)) p.push('No website quote request on record');
  else if (nowMs - lastQuote > t.quoteQuietDays * DAY) p.push(`No website quote in ${Math.round((nowMs - lastQuote) / DAY)} days. Is the form working?`);

  const g = s.gmail_sync || {};
  const lastSync = Date.parse(g.last_ok_at || '');
  if (!Number.isFinite(lastSync)) p.push('Gmail sync: no successful run recorded');
  else if (nowMs - lastSync > t.gmailSyncMaxAgeHours * HOUR) p.push(`Gmail sync last worked ${ago(g.last_ok_at, nowMs)}. Client replies are not being imported`);
  if (g.last_error && Date.parse(g.last_error_at || '') > (Number.isFinite(lastSync) ? lastSync : 0)) {
    p.push(`Gmail sync error: ${clip(g.last_error, 120)}`);
  }

  const ch = s.channels || {};
  for (const [key, label, primary] of CHANNELS) {
    const c = ch[key] || {};
    const tries = Number(c.attempts_24h) || 0;
    const ok = Number(c.ok_24h) || 0;
    const wasActive = !!c.ok_30d;
    if (tries > 0 && ok === 0 && (primary || wasActive)) {
      p.push(`${label}: all ${tries} alert${tries === 1 ? '' : 's'} failed in 24h` + (c.last_error ? ` (${clip(c.last_error, 80)})` : ''));
      continue;
    }
    const lastOk = Date.parse(c.last_ok_at || '');
    if (wasActive && Number.isFinite(lastOk) && nowMs - lastOk > t.channelStaleDays * DAY && Number(c.attempts_since_ok) > 0) {
      p.push(`${label} has not delivered since ${ago(c.last_ok_at, nowMs)}`);
    }
  }

  const lost = Number(s.alerts_undelivered_24h) || 0;
  if (lost > 0) p.push(`${lost} alert${lost === 1 ? '' : 's'} reached neither Telegram nor email`);
  return p;
}

export function buildHeartbeat(stats, probe, nowMs, opts) {
  const s = stats || {};
  const o = opts || {};
  const day = new Date(nowMs).toLocaleDateString('en-US', {
    timeZone: o.timeZone || 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  });
  const problems = heartbeatProblems(s, probe, nowMs);
  const n = (v) => Number(v) || 0;
  const lines = [];
  lines.push(`🩺 Good Liquid daily check, ${day}`);
  lines.push('');
  if (problems.length) {
    lines.push(`⚠️ ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
    for (const x of problems) lines.push('• ' + x);
  } else {
    lines.push('✅ Everything is flowing');
  }
  lines.push('');
  lines.push('Last 24h:');
  lines.push(`• Website quotes: ${n(s.quotes_24h)} (last ${ago(s.last_quote_at, nowMs)})`);
  lines.push(`• New deals: ${n(s.deals_24h)}`);
  lines.push(`• Tour requests: ${n(s.tours_24h)}` + (n(s.tours_pending) ? ` (${n(s.tours_pending)} awaiting approval)` : ''));
  lines.push(`• Onboarding forms: ${n(s.onboarding_24h)}`);
  lines.push(`• Portal requests: ${n(s.portal_requests_24h)}` + (n(s.portal_requests_open) ? ` (${n(s.portal_requests_open)} open)` : ''));
  lines.push(`• Client/lead emails in: ${n(s.inbound_emails_24h)}` + (n(s.inbound_client_emails_24h) ? ` (${n(s.inbound_client_emails_24h)} from clients)` : ''));
  const ch = s.channels || {};
  const parts = CHANNELS.map(([key, label]) => {
    const c = ch[key] || {};
    return `${label} ${n(c.ok_24h)}/${n(c.attempts_24h)}`;
  });
  lines.push('');
  lines.push(`Alerts sent: ${n(s.alerts_24h)} · ${parts.join(' · ')}`);
  lines.push(`Quote form test: ${probe && probe.status === 'ok' ? 'passed' : probe ? probe.status : 'not run'}`);
  return { text: lines.join('\n'), problems };
}
