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
//     max?: number,         // max Gmail messages to scan (default 150, max 500)
//     email?: string }      // sync just this one address (fast, on-demand)
//
// RESPONSE: { ok, scanned, matched, inserted, skipped, contacts }
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
import { getGmailAccessToken as getAccessToken, gmailConfigured } from '../_shared/gmail-creds.ts';
import { isCronCall } from '../_shared/cron-auth.ts';

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
  const max  = Math.min(Math.max(Number(body.max)  || 150, 1), 500);
  const onlyEmail = body.email ? String(body.email).trim().toLowerCase() : '';

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // For an on-demand single-address sync, the company domain of that address
  // (if it's not a free provider) — so "sync this lead" pulls in mail from
  // anyone else at the same company too, not just the one address on file.
  const onlyDomain = onlyEmail ? companyDomain(onlyEmail) : '';

  // ── 1) Known contacts: clients (primary + additional) and pipeline leads ──
  // Map address → client id so inbound rows can be linked to the client row.
  const contacts = new Map<string, string | null>();
  // Map company domain → client id: a client/lead often starts on one address
  // and later writes from another at the same company. Matching only exact
  // addresses silently dropped half the thread, so we also keep any message
  // to/from a known company domain (never a free provider).
  const domainOwner = new Map<string, string | null>();
  const addContact = (email: unknown, clientId: string | null) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e.includes('@')) return;
    // In single-address mode we still want the whole COMPANY, so accept any
    // address at the target domain here rather than only the exact address.
    if (onlyEmail && e !== onlyEmail && !(onlyDomain && companyDomain(e) === onlyDomain)) return;
    if (!contacts.has(e) || (clientId && !contacts.get(e))) contacts.set(e, clientId);
    const dom = companyDomain(e);
    if (dom && (!onlyEmail || dom === onlyDomain)) {
      if (!domainOwner.has(dom) || (clientId && !domainOwner.get(dom))) domainOwner.set(dom, clientId);
    }
  };

  const cRes = await supa.from('clients').select('id, email, additional_emails');
  for (const c of cRes.data || []) {
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
  const dRes = await supa.from('deals').select('email');
  for (const d of dRes.data || []) addContact((d as Record<string, unknown>).email, null);

  if (!contacts.size) {
    return jsonResponse({ ok: true, scanned: 0, matched: 0, inserted: 0, skipped: 0, contacts: 0,
      note: onlyEmail ? 'That address is not a known client or lead.' : 'No client or lead email addresses on file.' });
  }

  // ── 2) List candidate Gmail messages ──
  let accessToken: string;
  try { accessToken = await getAccessToken(); }
  catch (e) { return errorResponse('Gmail token error: ' + String(e), 500); }

  const gFetch = (path: string) =>
    fetch(GMAIL_API + path, { headers: { Authorization: `Bearer ${accessToken}` } });

  // For a single address let Gmail do the filtering (cheap + precise).
  // For a full sync, scan recent mail and filter locally against `contacts`.
  // In single-address mode, also search the whole company domain (Gmail's
  // `from:domain.com` matches every sender at that domain) so a lead who wrote
  // from a second address at the same company still gets pulled in.
  const onlyClause = onlyEmail
    ? (onlyDomain
        ? `(from:${onlyEmail} OR to:${onlyEmail} OR from:${onlyDomain} OR to:${onlyDomain})`
        : `(from:${onlyEmail} OR to:${onlyEmail})`)
    : '';
  const q = onlyEmail
    ? `newer_than:${days}d -in:chats ${onlyClause}`
    : `newer_than:${days}d -in:chats`;

  const ids: string[] = [];
  let pageToken = '';
  while (ids.length < max) {
    const pageSize = Math.min(100, max - ids.length);
    const listRes = await gFetch(
      `/messages?maxResults=${pageSize}&q=${encodeURIComponent(q)}` +
      (pageToken ? `&pageToken=${pageToken}` : ''));
    if (!listRes.ok) {
      const errText = await listRes.text().catch(() => '');
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
    for (const m of page.messages || []) ids.push(m.id);
    pageToken = page.nextPageToken || '';
    if (!pageToken) break;
  }

  // ── 3) Read headers, keep messages involving a known contact ──
  interface Row {
    direction: string; from_email: string | null; to_email: string;
    subject: string; body_preview: string; status: string;
    client_id: string | null; mailgun_id: string; sent_at: string;
  }
  const candidates: Row[] = [];
  let scanned = 0;

  for (const id of ids) {
    // format=full (not metadata) so the actual body comes back, not just a snippet.
    const mRes = await gFetch(`/messages/${id}?format=full`);
    if (!mRes.ok) continue;
    const msg = await mRes.json();
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
    const inboundMatch  = fromAddrs.find((a) => contacts.has(a)) || fromAddrs.find(domainHit);
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
      body_preview: trimToNewMessage(
        extractBody(msg.payload) || decodeEntities(String(msg.snippet || ''))).slice(0, 8000),
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
  // same contact on the row.
  let inserted = 0, skipped = 0;
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
        .select('id, subject, to_email, from_email, sent_at, created_at, body_preview')
        .gte('sent_at', lo).lte('sent_at', hi).limit(2000);
      if (!pRes.error) priorRows = (pRes.data || []) as Record<string, unknown>[];
      else console.warn('[gmail-sync] content-dedup lookup failed:', pRes.error.message);
    }

    // "Re: x" and "x" are the same conversation for dedup purposes.
    const normSubject = (v: unknown) =>
      String(v || '').replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Returns the existing row this candidate duplicates, or null if it's new.
    const findExisting = (c: Row): { id: string; body: string } | null => {
      const hit = byId.get(c.mailgun_id);
      if (hit) return hit;
      const cSub = normSubject(c.subject);
      const cAt = Date.parse(c.sent_at);
      const contact = String((c.direction === 'inbound' ? c.from_email : c.to_email) || '').toLowerCase();
      for (const e of priorRows) {
        if (normSubject(e.subject) !== cSub) continue;
        const eAt = Date.parse(String(e.sent_at || e.created_at || ''));
        if (!Number.isFinite(eAt) || !Number.isFinite(cAt)) continue;
        if (Math.abs(eAt - cAt) > 10 * 60000) continue;
        // Direction is intentionally not compared: older rows predate the column.
        const addrs = (String(e.to_email || '') + ' ' + String(e.from_email || '')).toLowerCase();
        if (contact && !addrs.includes(contact)) continue;
        return { id: String(e.id), body: String(e.body_preview || '') };
      }
      return null;
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
      const uRes = await supa.from('email_log').update({ body_preview: u.body }).eq('id', u.id);
      if (uRes.error) console.warn('[gmail-sync] body upgrade failed:', uRes.error.message);
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
          continue;
        }
      }
      inserted += batch.length;
    }
  }

  console.log(`[gmail-sync] scanned=${scanned} matched=${candidates.length} inserted=${inserted} skipped=${skipped}`);
  const upgradedCount = Number((globalThis as Record<string, unknown>).__glUpgraded || 0);
  return jsonResponse({
    ok: true, scanned, matched: candidates.length, inserted, skipped,
    upgraded: upgradedCount, contacts: contacts.size,
  });
});
