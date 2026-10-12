/*
 * sales-deck.mjs — the pure logic behind the automatic sales-deck email.
 *
 * The quote-decks edge function emails the Good Liquid capabilities and
 * pricing deck to every new website quote request, once per prospect. This
 * module holds every decision that matters and none of the I/O, so
 * tests/sales-deck.test.mjs exercises the exact code the function runs:
 *
 *   deckEmail             the approved email (subject, plain text, HTML)
 *   firstName             "first word of contact_name", or "there"
 *   isQuoteRequestDeal    only website quote requests get the deck
 *   deckSendDecision      once per prospect: should this deal get it now?
 *   pickSendableDeck      which deck, refusing anything confidential or
 *                         anything that names a client
 *   deckSendFailedMessage the alert text Mike gets when a send fails
 *
 * WHY THE DECK PICKER IS PARANOID
 * sales_decks also holds lotus_nutra_pricing: ANOTHER CLIENT'S confidential
 * R&D pricing. Clients are competing beverage brands, and emailing one
 * brand's pricing to a stranger who filled in a web form is the worst
 * commercial outcome this system can produce. auto_send is admin-only and at
 * most one row can have it, but a toggle is one click, so the sender refuses
 * on its own as well: a deck whose key or label says "confidential", or names
 * any existing client, is never sent no matter what its flags say.
 *
 * Plain ESM, no imports, no I/O: Deno and Node load it unchanged.
 */

export const DECK_TEMPLATE = 'sales_deck';
export const QUOTE_REQUEST_SUFFIX = ' — Quote Request';
// Gmail refuses messages over 25 MB, and base64 makes an attachment about a
// third bigger on the wire. 15 MB of PDF is ~20 MB encoded: under the limit
// with room for the message itself. The CRM upload enforces the same number.
export const MAX_DECK_BYTES = 15 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function oneLine(s, max) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

export function validEmail(e) {
  const s = String(e == null ? '' : e).trim();
  return s.length <= 200 && EMAIL_RE.test(s);
}

// "First word of contact_name; fall back to 'there'." Surrounding punctuation
// is dropped ("Ann," -> "Ann"), and an all-lowercase name gets a capital, since
// people type their own name in a hurry. A token with no letters is no name.
export function firstName(contactName) {
  const first = oneLine(contactName, 200).split(' ')[0] || '';
  const word = first.replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, '').replace(/[.'-]+$/, '').slice(0, 40);
  if (!/\p{L}/u.test(word)) return 'there';
  return word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// The approved email, laid out to Mike's standing email rules: no dashes as
// punctuation, proper grammar, indented paragraphs, greeting / body /
// closing / signature. (The first draft's subject used an em dash.)
export function deckEmail(deal) {
  const d = deal || {};
  const name = firstName(d.contact_name);
  const brand = oneLine(d.client_name, 120) || 'your brand';
  const subject = 'Good Liquid Bev Co: Capabilities and Pricing';
  const para2 = 'Thank you for reaching out about ' + brand + '. Attached is our capabilities and pricing deck so you can see how we work, our minimums, and our rate card. We will follow up within one business day to talk through your project.';
  // Plain text: the body paragraph carries a first-line indent, as in a letter.
  const text = 'Hi ' + name + ',\n\n     ' + para2 + '\n\nBest regards,\n\nMike Krail\nGood Liquid Bev Co';
  const p = 'margin:0 0 14px';
  const body = p + ';text-indent:2.5em';
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a2433;max-width:560px">' +
    '<p style="' + p + '">Hi ' + escHtml(name) + ',</p>' +
    '<p style="' + body + '">' + escHtml(para2) + '</p>' +
    '<p style="' + p + '">Best regards,</p>' +
    '<p style="' + p + '">Mike Krail<br>Good Liquid Bev Co</p>' +
    '</div>';
  return { subject, text, html };
}

// Only deals the public website form created get the deck. submit_quote_request
// names them "<brand> — Quote Request" (the same test trigger_notify_new_deals
// uses to tell them apart).
export function isQuoteRequestDeal(deal) {
  return !!deal && typeof deal.name === 'string' && deal.name.endsWith(QUOTE_REQUEST_SUFFIX);
}

/*
 * Once per prospect. Returns { send: true } or { send: false, reason }.
 *   deal            the deals row
 *   sentToEmailAt   timestamp of an earlier successful sales_deck email to the
 *                   same address (from email_log), or null
 */
export function deckSendDecision(deal, sentToEmailAt) {
  if (!deal) return { send: false, reason: 'deal not found' };
  if (!isQuoteRequestDeal(deal)) return { send: false, reason: 'not a website quote request' };
  if (!validEmail(deal.email)) return { send: false, reason: 'no valid email on the deal' };
  if (deal.deck_sent_at) return { send: false, reason: 'deck already sent to this deal' };
  if (sentToEmailAt) return { send: false, reason: 'deck already sent to this email address' };
  return { send: true };
}

// Lowercase words only: "Lotus  nutra" and "lotus_nutra_pricing" both become
// "lotus nutra ...", so a key, a label and a client name compare as words.
export function normWords(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const OWN_NAMES = ['good liquid', 'goodliquid'];

/*
 * Which deck, if any, may go to a prospect.
 *   decks        sales_decks rows
 *   clientNames  every clients.name
 * Returns { deck, refused: [{ key, label, reason }], missing: bool }.
 *   deck     the one sendable deck, or null
 *   missing  an auto-send deck exists but has no PDF uploaded yet
 */
export function pickSendableDeck(decks, clientNames) {
  const clients = [...new Set((clientNames || []).map(normWords))]
    .filter((c) => c.length >= 4 && !OWN_NAMES.some((o) => c.includes(o)));
  const refused = [];
  let missing = false;
  let deck = null;
  const candidates = (decks || []).filter((d) => d && d.auto_send === true && d.active === true)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  for (const d of candidates) {
    const hay = ' ' + normWords(d.key) + ' ' + normWords(d.label) + ' ' + normWords(d.filename) + ' ';
    if (/ confidential /.test(hay)) {
      refused.push({ key: d.key, label: d.label, reason: 'it is labelled confidential' });
      continue;
    }
    const named = clients.find((c) => hay.includes(' ' + c + ' '));
    if (named) {
      refused.push({ key: d.key, label: d.label, reason: 'it names a client (' + named + ')' });
      continue;
    }
    if (!d.storage_path) { missing = true; continue; }
    if (!deck) deck = d;
  }
  return { deck, refused, missing };
}

/*
 * The alert Mike gets (Telegram + email, via notify-deal) when a deck did not
 * go out. Plain text: Telegram is sent without parse_mode and the email as
 * text/plain, so lead-typed values cannot become markup.
 * data: { company, name, email, reason }
 */
export function deckSendFailedMessage(data) {
  const d = data || {};
  const company = oneLine(d.company, 120);
  const who = oneLine(d.name, 120);
  const email = oneLine(d.email, 200);
  const reason = oneLine(d.reason, 400) || 'unknown error';
  const lead = company || who || email || 'a website lead';
  const short = '⚠️ SALES DECK NOT SENT to ' + lead + (email && lead !== email ? ' (' + email + ')' : '') + ': ' + reason +
    '. Send it by hand, or fix it in the CRM (AI Tools → Settings & Integrations → Sales Decks).';
  const body = [
    'The automatic capabilities and pricing deck did not go out.',
    '',
    'Brand:   ' + (company || '—'),
    'Contact: ' + (who || '—'),
    'Email:   ' + (email || '—'),
    'Reason:  ' + reason,
    '',
    'Send the deck by hand if this was a real lead. To change or upload the deck, open the CRM:',
    'AI Tools → Settings & Integrations → Sales Decks.',
  ].join('\n');
  return { short, subject: '⚠️ Sales deck not sent: ' + lead, body };
}
