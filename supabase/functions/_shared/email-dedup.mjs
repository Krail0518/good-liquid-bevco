/*
 * email-dedup.mjs — does a message gmail-sync just read from Gmail already
 * exist in email_log?
 *
 * WHY THIS EXISTS
 * The content fallback used to match on normalised subject ("Re:" stripped)
 * + sent within 10 minutes + the contact's address on the row, and
 * deliberately ignored direction. So when Mike emailed a client and the client
 * answered in the same thread within 10 minutes, the client's reply matched
 * Mike's outbound row, was treated as already logged, was never imported and
 * never raised an alert. A quick reply is the one most likely to need one.
 *
 * Rules, in order:
 *   1. The Gmail message id is already stored (email_log.mailgun_id): dup.
 *   2. Both rows carry a Gmail message id and they differ: NOT a dup. One
 *      Gmail message has exactly one id, so two ids are two messages.
 *   3. Both rows have a direction and they differ: NOT a dup. Mike's
 *      outbound and the client's inbound reply are two messages.
 *   4. Otherwise (a row the CRM logged without the Gmail id, or an old row
 *      without a direction): same normalised subject, within 10 minutes, and
 *      the contact's address on the row — the CRM-logged outbound and its
 *      Gmail copy.
 *
 * Plain ESM, no imports, no I/O: Deno (gmail-sync) and Node
 * (tests/email-dedup.test.mjs) load the same file.
 */

export const DEDUP_WINDOW_MS = 10 * 60000;

// Gmail API message ids are 16 lowercase hex characters. Ids from other
// providers (Mailgun "<...@mail...>", legacy rows) do not look like this, so
// rule 2 never fires on them.
const GMAIL_ID = /^[0-9a-f]{16}$/;
export const isGmailId = (v) => GMAIL_ID.test(String(v || ''));

// "Re: x", "RE: Fwd: x" and "x" are the same conversation for dedup purposes.
export function normSubject(v) {
  return String(v || '').replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// c: a candidate { direction, from_email, to_email, subject, sent_at, mailgun_id }
// e: an existing email_log row (same fields + created_at)
export function sameEmail(c, e) {
  if (!c || !e) return false;
  const cId = String(c.mailgun_id || '');
  const eId = String(e.mailgun_id || '');
  if (cId && eId && cId === eId) return true;
  if (isGmailId(cId) && isGmailId(eId)) return false;
  const cDir = String(c.direction || '');
  const eDir = String(e.direction || '');
  if (cDir && eDir && cDir !== eDir) return false;
  if (normSubject(e.subject) !== normSubject(c.subject)) return false;
  const eAt = Date.parse(String(e.sent_at || e.created_at || ''));
  const cAt = Date.parse(String(c.sent_at || ''));
  if (!Number.isFinite(eAt) || !Number.isFinite(cAt)) return false;
  if (Math.abs(eAt - cAt) > DEDUP_WINDOW_MS) return false;
  const contact = String((cDir === 'inbound' ? c.from_email : c.to_email) || '').toLowerCase();
  const addrs = (String(e.to_email || '') + ' ' + String(e.from_email || '')).toLowerCase();
  if (contact && !addrs.includes(contact)) return false;
  return true;
}

// byId: Map(mailgun_id -> existing) for ids already stored; priorRows: rows
// logged around the same time. Returns the existing row or null.
export function findExistingEmail(c, byId, priorRows) {
  const hit = byId && c && c.mailgun_id ? byId.get(String(c.mailgun_id)) : undefined;
  if (hit) return hit;
  for (const e of priorRows || []) {
    if (sameEmail(c, e)) return e;
  }
  return null;
}
