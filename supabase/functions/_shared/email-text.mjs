/*
 * email-text.mjs — pure text helpers shared by the Gmail edge functions.
 *
 * WHY THIS IS A SEPARATE MODULE
 * These functions carry the fiddliest logic in the mail pipeline: pulling a
 * readable body out of a MIME tree, cutting a quoted reply chain, decoding HTML
 * entities. They had no automated coverage, and every bug found in them was
 * reported by the owner looking at a real email — snippet-instead-of-body,
 * "&#39;" leaking through, a three-line reply arriving with 900 characters of
 * quoted thread stuck to it.
 *
 * Pulling them out means tests/email-text.test.mjs exercises THE SAME CODE the
 * deployed function runs. Previously the checks lived in throwaway scripts with
 * hand-copied logic, which can silently drift from the real thing and give a
 * false green.
 *
 * Plain ESM with no Deno or Node APIs beyond atob / TextDecoder, so both
 * runtimes can import it unchanged. Keep it that way: no imports, no I/O.
 */

// Gmail encodes body data as base64url. Decode to real UTF-8 text (a plain atob
// would mangle any accented character or emoji).
export function b64urlToText(data) {
  try {
    const b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) { return ''; }
}

// Last resort when a message carries no text/plain part: turn the HTML body
// into something readable rather than showing markup.
export function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Pull the readable body out of a Gmail message payload. Walks the whole MIME
// tree (messages are often multipart/alternative inside multipart/mixed) and
// prefers text/plain, falling back to de-tagged HTML.
//
// This exists because fetching format=metadata only yields Gmail's ~200-char
// `snippet`, which made every synced email look cut off mid-sentence.
// Gmail's `snippet` field is HTML-escaped, so a raw fallback stored text like
// "you&#39;re" and "&gt; wrote:". Decode the entities before storing.
export function decodeEntities(t) {
  return String(t)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/gi, "'").replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => { try { return String.fromCodePoint(Number(d)); } catch (e) { return _m; } })
    .replace(/&amp;/gi, '&');   // last, so "&amp;lt;" doesn't become "<"
}

// Markers that begin quoted history or a mail-client footer. The EARLIEST match
// wins, since the junk always follows the message.
export function replyTailIndex(t) {
  const cuts = [];
  const push = (m) => { if (m && m.index !== undefined) cuts.push(m.index); };

  push(t.match(/^[ \t]*On\s[\s\S]{0,300}?\bwrote:[ \t]*$/im));      // Gmail / Apple Mail
  push(t.match(/^[ \t]*-{2,}\s*Original Message\s*-{2,}/im));         // Outlook classic
  push(t.match(/^[ \t]*_{10,}[ \t]*$/m));                             // Outlook divider rule
  push(t.match(/^[ \t]*(Get Outlook for|Sent from my |Sent via |Get BlueMail)/im));
  push(t.match(/^[ \t]*>{1,}[ \t]?\S/m));                             // ">" quoted block

  // Outlook header block: "From:" only counts as quoted history when a
  // Sent:/Date: line follows close behind — otherwise it could be real prose.
  const fromRe = /^[ \t]*From:[ \t]*\S[^\n]*$/gim;
  let m;
  while ((m = fromRe.exec(t)) !== null) {
    if (/^[ \t]*(Sent|Date):[ \t]*\S/im.test(t.slice(m.index, m.index + 400))) { cuts.push(m.index); break; }
  }

  const valid = cuts.filter((i) => i > 0);
  return valid.length ? Math.min(...valid) : -1;
}

// True when this text still carries a quoted tail — used to decide whether an
// already-stored (untrimmed) copy is worth replacing with a trimmed one.
export function hasReplyTail(t) {
  return replyTailIndex(String(t || '')) > 0;
}

// Strip link wrappers and inline-image placeholders that carry no information.
export function tidyBody(t) {
  return String(t)
    // Plain-text mail renders links as "Label<https://…>"; drop the giant URL,
    // keep the label. Proofpoint wrappers are hundreds of characters each.
    .replace(/<https?:\/\/[^>\s]{60,}>/g, '')
    .replace(/\[(?:photo|image[^\]]*|cid:[^\]]*|__[a-z0-9_]+__)\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Keep just the new message. Falls back to the full text if trimming would
// leave almost nothing — better a noisy email than an empty one.
export function trimToNewMessage(raw) {
  const full = tidyBody(raw);
  const cut = replyTailIndex(full);
  if (cut <= 0) return full;
  const head = tidyBody(full.slice(0, cut));
  return head.length >= 20 ? head : full;
}

export function extractBody(payload) {
  const plain = [];
  const html = [];
  const walk = (part) => {
    if (!part) return;
    const mime = String(part.mimeType || '');
    const body = part.body;
    const data = body && typeof body.data === 'string' ? body.data : '';
    if (data) {
      if (mime === 'text/plain')     plain.push(b64urlToText(data));
      else if (mime === 'text/html') html.push(b64urlToText(data));
    }
    const parts = part.parts;
    if (Array.isArray(parts)) parts.forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join('\n').trim();
  if (html.length)  return htmlToText(html.join('\n'));
  return '';
}
