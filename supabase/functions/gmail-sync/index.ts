// gmail-sync — pulls real email correspondence from Gmail into email_log so
// the CRM shows the full two-way thread under each client and lead.
//
// WHY THIS EXISTS
// ---------------
// The CRM only ever logged mail it sent itself. Anything Mike sent from the
// Gmail app on his phone, and every reply a client sent back, was invisible in
// the CRM — so a client he'd emailed for weeks looked like it had no history.
// This function closes that gap by reading Gmail directly. No Mailgun inbound
// route or MX records required (that older path is left in place but is no
// longer the only way replies can arrive).
//
// HOW IT WORKS
// ------------
//   1. Builds the set of "known contacts" — every clients.email (+ the
//      additional_emails JSONB list) and every deals.email.
//   2. Lists recent Gmail messages and reads just their headers.
//   3. Keeps a message only if its From or To/Cc matches a known contact:
//        From matches → direction 'inbound'  (they wrote to us)
//        To/Cc matches → direction 'outbound' (we wrote to them)
//   4. Inserts into email_log, skipping anything already stored.
//
// IDEMPOTENT: the Gmail message id is stored in email_log.mailgun_id (a legacy
// column name that now just holds whichever provider's id applies). Existing
// ids are looked up first and skipped, so running this repeatedly — on a
// schedule and on demand — never creates duplicates.
//
// REQUEST (POST JSON, all optional):
//   { days?: number,        // how far back to look (default 30, max 365)
//     max?: number,         // max Gmail messages to list (default 150, max 3000)
//     email?: string }      // sync just this one address (fast, on-demand)
//
// RESPONSE: { ok, scanned, matched, inserted, skipped, contacts, partial, remaining }
//   partial/remaining: the run hit its time budget; call again to continue.
//
// AUTH: a staff JWT (for the in-app "Sync now" button) OR the CRON_SECRET
// (for the scheduled run), matching the pattern used by daily-digest.
//
// SECRETS: the same Gmail OAuth secrets gmail-send uses —
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// IMPORTANT: the refresh token must include the read scope
//   https://www.googleapis.com/auth/gmail.readonly
// A send-only token returns 403 from the list call; the response says so
// explicitly rather than failing silently.
//
// Deploy: supabase functions deploy gmail-sync

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
// Body extraction, quoted-thread trimming and entity decoding live in a shared
// plain-ESM module so tests/email-text.test.mjs can exercise the same code this
// function runs (see the header of that module for why).
import {
  decodeEntities, extractBody, hasReplyTail, trimToNewMessage,
} from '../_shared/email-text.mjs';
// Credentials resolve Vault-first (written by the in-app Connect Gmail flow),
// falling back to the legacy GMAIL_* env secrets — see gmail-creds.ts.
import { getGmailAccessToken as getAccessToken, gmailConfigured, vaultGet } from '../_shared/gmail-creds.ts';
import { isCronCall } from '../_shared/cron-auth.ts';
import { redactSignLinks } from '../_shared/token-links.ts';
import { logNotification } from '../_shared/alert-delivery.ts';
import { selectReplyAlerts } from '../_shared/inbound-alarms.mjs';
import { findExistingEmail } from '../_shared/email-dedup.mjs';

// ALERTS FOR CLIENT REPLIES
// This function imported client and lead replies into email_log and told
// nobody: the client_email_reply alert existed only in mailgun-inbound, which
// is not in use. Now, after each run, the rows THIS run inserted (never rows
// that were already stored) that are inbound, from outside Good Liquid's own
// domains, recent, and not an auto-reply go to notify-deal: one alert each for
// up to three, otherwise one summary. Rules: selectReplyAlerts() in
// _shared/inbound-alarms.mjs, covered by tests/inbound-alarms.test.mjs.
//
// HEARTBEAT
// Every full sync (not a single-lead sync) records its outcome in
// notification_log (source 'gmail-sync', event 'sync_run'), so the daily
// inbound-heartbeat can say "Gmail sync last worked 5h ago". pg_cron reports
// "succeeded" as soon as the HTTP request is queued, so cron.job_run_details
// cannot tell whether a sync actually ran.

async function alertReplies(
  rows: Array<Record<string, unknown>>,
  clientNames: Map<string, string>,
  leadNames: Map<string, string>,
): Promise<number> {
  const pick = selectReplyAlerts(rows, Date.now());
  if (pick.mode === 'none') return 0;
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secret = await vaultGet('gl_notify_secret');
  if (!supaUrl || !serviceKey || !secret) {
    console.error('[gmail-sync] cannot alert on client replies: notify secret or service key missing');
    return 0;
  }
  const who = (r: Record<string, unknown>) => {
    const cid = r.client_id ? String(r.client_id) : '';
    if (cid && clientNames.has(cid)) return { name: clientNames.get(cid)!, kind: 'client' };
    const from = String(r.from_email || '').toLowerCase();
    return { name: leadNames.get(from) || '', kind: cid ? 'client' : 'lead' };
  };
  const post = (event: string, data: Record<string, string>) =>
    fetch(`${supaUrl}/functions/v1/notify-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ event, secret, data }),
    }).then((r) => { if (!r.ok) console.error('[gmail-sync] notify-deal answered', r.status); })
      .catch((e) => console.error('[gmail-sync] notify-deal error:', e));

  if (pick.mode === 'each') {
    for (const r of pick.items as Array<Record<string, unknown>>) {
      const w = who(r);
      await post('client_email_reply', {
        from_email: String(r.from_email || ''), subject: String(r.subject || ''),
        body_preview: String(r.body_preview || '').slice(0, 400),
        client: w.name, kind: w.kind,
      });
    }
  } else {
    const lines = (pick.items as Array<Record<string, unknown>>).map((r) => {
      const w = who(r);
      return `${w.name || String(r.from_email || '')} — ${String(r.subject || '(no subject)')}`;
    });
    await post('client_email_replies', { count: String(lines.length), lines: lines.join('\n') });
  }
  return pick.items.length;
}

function recordRun(ok: boolean, error: string | null, detail: Record<string, unknown>) {
  return logNotification({ source: 'gmail-sync', event: 'sync_run', ok, error, detail });
}

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Free/consumer providers — a contact's own address may live at one of these,
// but the DOMAIN is never "their company", so we must not vacuum every message
// at gmail.com into one client's thread. Mirrors GL_FREE_EMAIL_DOMAINS in
// index.html so the ingest side and the read side agree on what counts as a
// company domain.
const FREE_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','ymail.com','yahoo.co.uk',
  'hotmail.com','outlook.com','live.com','msn.com','aol.com',
  'icloud.com','me.com','mac.com','proton.me','protonmail.com',
  'gmx.com','zoho.com','mail.com','comcast.net','verizon.net','att.net','sbcglobal.net',
]);

// Good Liquid's own domains. Never a contact: an internal test client on
// @goodliquid.com made every email Mike sent look like it came FROM a
// contact, so 525 sent emails were stored as inbound, 450 of them filed
// under that test client, and 184 internal alert emails were pulled in.
const OWN_DOMAINS = new Set(['goodliquid.com', 'goodliquidbevco.com']);

// The company domain of an address, or '' if it's a free provider / malformed.
// Used to attribute mail from a NEW address at a company we already know
// (a client emails from sarah@acme.com after we only had john@acme.com).
function companyDomain(email: string): string {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  const clean = d.replace(/^www\./, '').trim();
  if (!clean || clean.indexOf('.') < 0 || FREE_DOMAINS.has(clean)) return '';
  return clean;
}

// Pulls the bare address out of a header value like
// `"Jane Doe" <jane@acme.com>, bob@acme.com` → ['jane@acme.com','bob@acme.com'].
function addressesIn(headerValue: string): string[] {
  if (!headerValue) return [];
  return headerValue.split(',').map((part) => {
    const m = part.match(/<([^>]+)>/);
    return (m ? m[1] : part).trim().toLowerCase();
  }).filter((a) => a.includes('@'));
}

function header(headers: { name: string; value: string }[], name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// A real email body carries the whole thread beneath the new message: the
// quoted reply chain, the sender's signature block, "Get Outlook for Mac", and
// (behind corporate mail filters) enormous urldefense.proofpoint.com link
// wrappers. Storing all of that made the correspondence popup unreadable after
// the first few lines. We keep the new message and drop the tail.

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Either the scheduled caller (Vault-held cron secret — see
  // _shared/cron-auth.ts) or a signed-in staff user.
  if (!(await isCronCall(req))) {
    const auth = await requireStaff(req);
    if (!auth.ok) return errorResponse(auth.error || 'Forbidden', auth.status);
  }

  if (!(await gmailConfigured())) {
    return errorResponse('Gmail is not connected — open Admin → 📧 Email Delivery and connect Gmail', 500);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* all params optional */ }
  const days = Math.min(Math.max(Number(body.days) || 30, 1), 365);
  // Full sweeps can match thousands of messages across every lead; a single
  // lead never needs more than a few hundred.
  const max  = Math.min(Math.max(Number(body.max)  || 150, 1), 3000);
  const startedAt = Date.now();
  // Stop opening new messages after this long so the request finishes well
  // inside the edge runtime's wall clock. Whatever is left is reported as
  // `remaining` and the caller simply runs again: ids already stored are
  // skipped before any fetch, so each run picks up where the last stopped.
  const BUDGET_MS = 95_000;
  // A single email field can hold SEVERAL addresses (a lead stored as
  // "rachel@housewata.com,hello@housewata.com"). Split on commas/semicolons so
  // each is a real, matchable address — an un-split value matches nothing and,
  // worse, yields a garbage domain ("housewata.com,hello") that never registers.
  const splitAddrs = (v: unknown): string[] =>
    String(v || '').toLowerCase().split(/[,;]/).map((s) => s.trim()).filter((s) => s.includes('@'));

  // For an on-demand sync of one lead: the target addresses AND their company
  // domains (non-free), so "sync this lead" pulls in mail from anyone else at
  // the same company too — even a second address at the same domain.
  const onlyEmails  = splitAddrs(body.email);
  const isOnly      = onlyEmails.length > 0;
  const onlyDomains = new Set(onlyEmails.map(companyDomain).filter(Boolean));

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── 1) Known contacts: clients (primary + additional) and pipeline leads ──
  // Map address → client id so inbound rows can be linked to the client row.
  const contacts = new Map<string, string | null>();
  // Map company domain → client id: a client/lead often starts on one address
  // and later writes from another at the same company. Matching only exact
  // addresses silently dropped half the thread, so we also keep any message
  // to/from a known company domain (never a free provider).
  const domainOwner = new Map<string, string | null>();
  const addContact = (email: unknown, clientId: string | null) => {
    for (const e of splitAddrs(email)) {
      if (OWN_DOMAINS.has(String(e).split('@')[1] || '')) continue;
      // In single-lead mode we still want the whole COMPANY, so accept the
      // target addresses and anything at their domain.
      if (isOnly && !onlyEmails.includes(e) && !onlyDomains.has(companyDomain(e))) continue;
      if (!contacts.has(e) || (clientId && !contacts.get(e))) contacts.set(e, clientId);
      const dom = companyDomain(e);
      if (dom && (!isOnly || onlyDomains.has(dom))) {
        if (!domainOwner.has(dom) || (clientId && !domainOwner.get(dom))) domainOwner.set(dom, clientId);
      }
    }
  };

  // Names, for the reply alerts: client id → name, lead address → deal name.
  const clientNames = new Map<string, string>();
  const leadNames = new Map<string, string>();

  const cRes = await supa.from('clients').select('id, name, email, additional_emails');
  for (const c of cRes.data || []) {
    const cn = String((c as Record<string, unknown>).name || '');
    if (cn) clientNames.set(String((c as Record<string, string>).id), cn);
    addContact((c as Record<string, unknown>).email, (c as Record<string, string>).id);
    const extra = (c as Record<string, unknown>).additional_emails;
    if (Array.isArray(extra)) {
      for (const item of extra) {
        addContact(typeof item === 'string' ? item : (item as Record<string, unknown>)?.email,
                   (c as Record<string, string>).id);
      }
    }
  }
  // Leads have no clients row, so they log with client_id null.
  const dRes = await supa.from('deals').select('email, name, client_name');
  for (const d of dRes.data || []) {
    const dr = d as Record<string, unknown>;
    addContact(dr.email, null);
    const label = String(dr.client_name || dr.name || '');
    if (label) for (const a of splitAddrs(dr.email)) if (!leadNames.has(a)) leadNames.set(a, label);
  }

  if (!contacts.size) {
    return jsonResponse({ ok: true, scanned: 0, matched: 0, inserted: 0, skipped: 0, contacts: 0,
      note: isOnly ? 'That address is not a known client or lead.' : 'No client or lead email addresses on file.' });
  }

  // ── 2) List candidate Gmail messages ──
  let accessToken: string;
  try { accessToken = await getAccessToken(); }
  catch (e) {
    if (!isOnly) await recordRun(false, 'Gmail token error: ' + String(e).slice(0, 300), {});
    return errorResponse('Gmail token error: ' + String(e), 500);
  }

  const gFetch = (path: string) =>
    fetch(GMAIL_API + path, { headers: { Authorization: `Bearer ${accessToken}` } });

  // Let Gmail do the filtering in BOTH modes. The full sweep used to list the
  // newest N messages in the whole mailbox and filter them here. Mike's inbox
  // carries hundreds of digests, alerts and vendor mails a week, so N=400
  // reached back only a few days: a lead emailed three weeks earlier was never
  // even looked at, and "Sync email history" reported success while leaving
  // most prospects with an empty correspondence panel. Now the query names the
  // contacts themselves, chunked so each query stays under Gmail's length limit.
  const terms: string[] = [];
  if (isOnly) {
    for (const a of onlyEmails)  terms.push(`from:${a}`, `to:${a}`, `cc:${a}`);
    for (const d of onlyDomains) terms.push(`from:${d}`, `to:${d}`, `cc:${d}`);
  } else {
    for (const a of contacts.keys())    terms.push(`from:${a}`, `to:${a}`, `cc:${a}`);
    for (const d of domainOwner.keys()) terms.push(`from:${d}`, `to:${d}`, `cc:${d}`);
  }
  const base = `newer_than:${days}d -in:chats`;
  const queries: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const t of terms) {
    if (cur.length && curLen + t.length + 1 > 1200) { queries.push(cur.join(' OR ')); cur = []; curLen = 0; }
    cur.push(t); curLen += t.length + 4;
  }
  if (cur.length) queries.push(cur.join(' OR '));

  const ids: string[] = [];
  const seenIds = new Set<string>();
  for (const terms of queries) {
    const q = `${base} (${terms})`;
    let pageToken = '';
    while (ids.length < max) {
      const pageSize = Math.min(100, max - ids.length);
      const listRes = await gFetch(
        `/messages?maxResults=${pageSize}&q=${encodeURIComponent(q)}` +
        (pageToken ? `&pageToken=${pageToken}` : ''));
      if (!listRes.ok) {
        const errText = await listRes.text().catch(() => '');
        if (!isOnly) await recordRun(false, `Gmail list failed ${listRes.status}: ${errText.slice(0, 300)}`, {});
        // A send-only refresh token fails here — say so plainly so the fix is obvious.
        if (listRes.status === 403) {
          return errorResponse(
            'Gmail refused to read mail (403). The connection is missing the ' +
            'gmail.readonly scope — reconnect Gmail from Admin → 📧 Email Delivery ' +
            '(the connect flow requests read + send together). ' + errText,
            403);
        }
        return errorResponse(`Gmail list failed ${listRes.status}: ${errText}`, listRes.status);
      }
      const page = await listRes.json();
      for (const m of page.messages || []) {
        if (!seenIds.has(m.id)) { seenIds.add(m.id); ids.push(m.id); }
      }
      pageToken = page.nextPageToken || '';
      if (!pageToken) break;
    }
    if (ids.length >= max) break;
  }

  // A full sweep skips messages already stored BEFORE downloading them, so a
  // re-run spends its time only on what is missing (and can resume after a
  // run that stopped at the time budget). A single-lead sync still reads them
  // all, because that is also how short stored bodies get filled in.
  let preSkipped = 0;
  let toFetch = ids;
  if (!isOnly && ids.length) {
    const stored = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await supa.from('email_log').select('mailgun_id').in('mailgun_id', chunk);
      for (const row of r.data || []) stored.add(String((row as Record<string, unknown>).mailgun_id));
    }
    toFetch = ids.filter((id) => !stored.has(id));
    preSkipped = ids.length - toFetch.length;
  }

  // ── 3) Read headers, keep messages involving a known contact ──
  interface Row {
    direction: string; from_email: string | null; to_email: string;
    subject: string; body_preview: string; status: string;
    client_id: string | null; mailgun_id: string; sent_at: string;
  }
  const candidates: Row[] = [];
  let scanned = 0;

  // format=full (not metadata) so the actual body comes back, not just a
  // snippet. Fetched a few at a time: one by one, a backfill of a few hundred
  // messages outran the edge runtime's wall clock.
  const messages: Record<string, any>[] = [];
  let remaining = 0;
  const CONCURRENCY = 8;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > BUDGET_MS) { remaining = toFetch.length - i; break; }
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map(async (id) => {
      const mRes = await gFetch(`/messages/${id}?format=full`);
      return mRes.ok ? await mRes.json() : null;
    }));
    for (const m of got) if (m) messages.push(m);
  }

  for (const msg of messages) {
    const id = String(msg.id);
    scanned++;
    const headers = msg.payload?.headers || [];
    const fromAddrs = addressesIn(header(headers, 'From'));
    const toAddrs   = addressesIn(header(headers, 'To')).concat(addressesIn(header(headers, 'Cc')));

    // Inbound if the sender is a known contact; otherwise outbound if a
    // recipient is. We match on the exact address first, then fall back to the
    // company domain — so a client writing from a new address at a company we
    // already track is still captured (the housewata.com case: correspondence
    // moved to a second @-address and vanished from the CRM). Messages
    // involving nobody we track — by address or company domain — are ignored.
    const domainHit = (a: string) => { const d = companyDomain(a); return d && domainOwner.has(d); };
    // Gmail's own SENT label settles the direction: a message we sent is
    // outbound whoever else is on it.
    const isSent = Array.isArray(msg.labelIds) && msg.labelIds.includes('SENT');
    const inboundMatch  = isSent ? undefined : (fromAddrs.find((a) => contacts.has(a)) || fromAddrs.find(domainHit));
    const outboundMatch = toAddrs.find((a) => contacts.has(a))   || toAddrs.find(domainHit);
    if (!inboundMatch && !outboundMatch) continue;

    const contactEmail = inboundMatch || outboundMatch!;
    const sentAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString();

    candidates.push({
      direction:    inboundMatch ? 'inbound' : 'outbound',
      from_email:   inboundMatch ? contactEmail : null,
      to_email:     inboundMatch ? (toAddrs[0] || '') : contactEmail,
      subject:      header(headers, 'Subject') || '(no subject)',
      // The real message text, falling back to Gmail's snippet only if the body
      // could not be decoded. Generous cap — the column is unlimited `text` and
      // the correspondence popup scrolls.
      // Signing-request emails carry a link that lets its holder sign as the
      // customer; it is removed before the text is stored (staff-readable).
      body_preview: redactSignLinks(trimToNewMessage(
        extractBody(msg.payload) || decodeEntities(String(msg.snippet || '')))).slice(0, 8000),
      status:       'delivered',
      // Exact address wins; otherwise attribute a domain-matched message to the
      // client that owns the company domain. `??` (not `||`) so an on-file lead
      // (client_id intentionally null) isn't re-resolved through the domain map.
      client_id:    contacts.get(contactEmail) ?? domainOwner.get(companyDomain(contactEmail)) ?? null,
      mailgun_id:   String(id),
      sent_at:      sentAt,
    });
  }

  // ── 4) Skip anything already logged, insert the rest ──
  //
  // Two dedup passes, because matching on the provider id alone is not enough.
  // The CRM records the Gmail message id when it sends, but rows written before
  // that capture existed (or by any path that didn't record an id) have none —
  // and those showed up as a second copy of an email the CRM had already
  // logged. So we also match on content: same subject, sent within ten minutes,
  // same contact on the row — but never across directions, and never between
  // two different Gmail message ids (_shared/email-dedup.mjs). Ignoring
  // direction made a client's reply within 10 minutes of Mike's email look
  // like Mike's email, so it was never imported and never alerted.
  let inserted = 0, skipped = 0, insertFailures = 0;
  // Rows this run actually stored with their direction — the only ones that
  // may raise a reply alert (a row already in email_log never re-alerts).
  const insertedRows: Row[] = [];
  if (candidates.length) {
    // (a) Precise: the Gmail message id is already stored.
    const byId = new Map<string, { id: string; body: string }>();
    for (let i = 0; i < candidates.length; i += 100) {
      const chunk = candidates.slice(i, i + 100).map((c) => c.mailgun_id);
      const eRes = await supa.from('email_log').select('id, mailgun_id, body_preview').in('mailgun_id', chunk);
      for (const row of eRes.data || []) {
        const r = row as Record<string, string>;
        if (r.mailgun_id) byId.set(r.mailgun_id, { id: r.id, body: r.body_preview || '' });
      }
    }

    // (b) Content: rows already logged around the same time as our candidates.
    const times = candidates.map((c) => Date.parse(c.sent_at)).filter((t) => Number.isFinite(t));
    let priorRows: Record<string, unknown>[] = [];
    if (times.length) {
      const lo = new Date(Math.min(...times) - 15 * 60000).toISOString();
      const hi = new Date(Math.max(...times) + 15 * 60000).toISOString();
      const pRes = await supa.from('email_log')
        .select('id, subject, to_email, from_email, direction, mailgun_id, sent_at, created_at, body_preview')
        .gte('sent_at', lo).lte('sent_at', hi).limit(2000);
      if (!pRes.error) priorRows = (pRes.data || []) as Record<string, unknown>[];
      else console.warn('[gmail-sync] content-dedup lookup failed:', pRes.error.message);
    }

    // Returns the existing row this candidate duplicates, or null if it's new.
    // The matching rules live in _shared/email-dedup.mjs (unit tested).
    const findExisting = (c: Row): { id: string; body: string } | null => {
      const hit = byId.get(c.mailgun_id);
      if (hit) return hit;
      const e = findExistingEmail(c, null, priorRows) as Record<string, unknown> | null;
      return e ? { id: String(e.id), body: String(e.body_preview || '') } : null;
    };

    // Rows logged before this function extracted real message bodies hold only
    // Gmail's ~200-char snippet (or a 280-char truncation from an old send), so
    // they read as cut off mid-sentence. When we now have substantially more
    // text for a message we already have, upgrade the stored copy in place
    // instead of skipping it. That backfills old entries on the next sync with
    // no manual cleanup.
    // Worth replacing a stored copy when either we now have more of the real
    // message, OR the stored copy still carries a quoted thread tail that we now
    // trim away. The second case means the replacement is SHORTER, so it is
    // gated on actually detecting a tail in the old copy and none in the new —
    // otherwise a misfiring trim could quietly shorten good content.
    const shouldReplace = (nb: string, sb: string): boolean => {
      if (!nb || nb === sb || nb.length < 20) return false;
      if (nb.length > sb.length + 20) return true;
      return nb.length < sb.length && hasReplyTail(sb) && !hasReplyTail(nb);
    };

    const upgrades: { id: string; body: string }[] = [];
    const fresh: Row[] = [];
    for (const c of candidates) {
      const existing = findExisting(c);
      if (!existing) { fresh.push(c); continue; }
      if (shouldReplace(c.body_preview, existing.body)) {
        upgrades.push({ id: existing.id, body: c.body_preview });
      }
    }
    skipped = candidates.length - fresh.length;

    let upgraded = 0;
    for (const u of upgrades) {
      const uRes = await supa.from('email_log').update({ body_preview: u.body }).eq('id', u.id).select('id');
      if (uRes.error || !uRes.data?.length) console.warn('[gmail-sync] body upgrade failed:', uRes.error?.message || 'no row updated');
      else upgraded++;
    }
    if (upgraded) console.log(`[gmail-sync] filled in the full text of ${upgraded} existing email(s)`);
    (globalThis as Record<string, unknown>).__glUpgraded = upgraded;

    for (let i = 0; i < fresh.length; i += 50) {
      const batch = fresh.slice(i, i + 50);
      let ins = await supa.from('email_log').insert(batch);
      if (ins.error) {
        // Older databases may lack direction/from_email/client_id. Retry without
        // the optional columns so the core history still lands.
        console.warn('[gmail-sync] full insert failed, retrying reduced:', ins.error.message);
        const reduced = batch.map((b) => ({
          to_email: b.to_email, subject: b.subject, body_preview: b.body_preview,
          status: b.status, mailgun_id: b.mailgun_id, sent_at: b.sent_at,
        }));
        ins = await supa.from('email_log').insert(reduced);
        if (ins.error) {
          console.error('[gmail-sync] insert failed:', ins.error.message);
          insertFailures += batch.length;
          continue;
        }
      } else {
        insertedRows.push(...batch);
      }
      inserted += batch.length;
    }
  }

  // Alert on fresh client/lead replies. Awaited so the requests go out before
  // the function returns; a failure here never fails the sync.
  let alerted = 0;
  try { alerted = await alertReplies(insertedRows as unknown as Array<Record<string, unknown>>, clientNames, leadNames); }
  catch (e) { console.error('[gmail-sync] reply alerts failed:', e); }

  console.log(`[gmail-sync] listed=${ids.length} scanned=${scanned} matched=${candidates.length} inserted=${inserted} skipped=${skipped + preSkipped} remaining=${remaining} alerted=${alerted}`);
  const upgradedCount = Number((globalThis as Record<string, unknown>).__glUpgraded || 0);
  if (!isOnly) {
    await recordRun(insertFailures === 0,
      insertFailures ? `${insertFailures} email(s) could not be stored in email_log` : null,
      { scanned, matched: candidates.length, inserted, skipped, alerted });
  }
  return jsonResponse({
    ok: true, scanned, matched: candidates.length, inserted, skipped: skipped + preSkipped,
    upgraded: upgradedCount, contacts: contacts.size, alerted,
    // partial: the time budget ran out; call again to continue.
    partial: remaining > 0, remaining,
  });
});
