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

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function getAccessToken(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GMAIL_CLIENT_ID')!,
      client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GMAIL_REFRESH_TOKEN')!,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`token refresh failed ${r.status}: ${t}`);
  }
  return (await r.json()).access_token as string;
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

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Either the scheduled caller (CRON_SECRET) or a signed-in staff user.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret') || '';
  const isCron = !!cronSecret && provided === cronSecret;
  if (!isCron) {
    const auth = await requireStaff(req);
    if (!auth.ok) return errorResponse(auth.error || 'Forbidden', auth.status);
  }

  if (!Deno.env.get('GMAIL_CLIENT_ID') || !Deno.env.get('GMAIL_REFRESH_TOKEN')) {
    return errorResponse('Gmail OAuth credentials not configured', 500);
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

  // ── 1) Known contacts: clients (primary + additional) and pipeline leads ──
  // Map address → client id so inbound rows can be linked to the client row.
  const contacts = new Map<string, string | null>();
  const addContact = (email: unknown, clientId: string | null) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e.includes('@')) return;
    if (onlyEmail && e !== onlyEmail) return;
    if (!contacts.has(e) || (clientId && !contacts.get(e))) contacts.set(e, clientId);
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
  const q = onlyEmail
    ? `newer_than:${days}d -in:chats (from:${onlyEmail} OR to:${onlyEmail})`
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
          'Gmail refused to read mail (403). The refresh token is missing the ' +
          'gmail.readonly scope — regenerate GMAIL_REFRESH_TOKEN with read access. ' + errText,
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
    const mRes = await gFetch(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To` +
      `&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`);
    if (!mRes.ok) continue;
    const msg = await mRes.json();
    scanned++;
    const headers = msg.payload?.headers || [];
    const fromAddrs = addressesIn(header(headers, 'From'));
    const toAddrs   = addressesIn(header(headers, 'To')).concat(addressesIn(header(headers, 'Cc')));

    // Inbound if the sender is a known contact; otherwise outbound if a
    // recipient is. Messages involving nobody we track are ignored.
    const inboundMatch  = fromAddrs.find((a) => contacts.has(a));
    const outboundMatch = toAddrs.find((a) => contacts.has(a));
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
      body_preview: String(msg.snippet || '').slice(0, 280),
      status:       'delivered',
      client_id:    contacts.get(contactEmail) || null,
      mailgun_id:   String(id),
      sent_at:      sentAt,
    });
  }

  // ── 4) Skip anything already logged, insert the rest ──
  let inserted = 0, skipped = 0;
  if (candidates.length) {
    const existing = new Set<string>();
    // Chunk the id lookup so a large sync doesn't build an oversized filter.
    for (let i = 0; i < candidates.length; i += 100) {
      const chunk = candidates.slice(i, i + 100).map((c) => c.mailgun_id);
      const eRes = await supa.from('email_log').select('mailgun_id').in('mailgun_id', chunk);
      for (const row of eRes.data || []) {
        if ((row as Record<string, string>).mailgun_id) existing.add((row as Record<string, string>).mailgun_id);
      }
    }
    const fresh = candidates.filter((c) => !existing.has(c.mailgun_id));
    skipped = candidates.length - fresh.length;

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
  return jsonResponse({
    ok: true, scanned, matched: candidates.length, inserted, skipped, contacts: contacts.size,
  });
});
