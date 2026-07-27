/*
 * mime-headers.mjs — RFC 2047 encoding for outbound email headers.
 *
 * WHY THIS EXISTS
 * Email headers must be plain ASCII. An invoice subject containing an em dash
 * arrived as "Invoice GL-1018 from Good Liquid Bev Co Ã¢Â€Â" $2,425.00" because
 * the raw UTF-8 was dropped straight into the Subject line. The same would
 * happen to any customer whose name carries an accent.
 *
 * Split out of gmail-send so tests/email-text.test.mjs can exercise the real
 * encoder rather than a hand-copied version that could drift from it.
 *
 * Plain ESM, no runtime APIs beyond btoa / TextEncoder, so Deno and Node both
 * import it unchanged. Keep it dependency-free.
 */

// Email headers must be plain ASCII. Any non-ASCII text (em-dash "—",
// accented customer names like "Café", emoji, etc.) has to be wrapped in an
// RFC 2047 "encoded-word" or the mail client mis-decodes the raw UTF-8 bytes
// and shows mojibake (e.g. "—" rendered as "Ã¢Â€Â"). Without this, subjects
// and display names built anywhere in the app arrive garbled.
export function isAscii(s) { return /^[\x00-\x7F]*$/.test(s); }

// Encode a header VALUE (e.g. a Subject) as one or more base64 encoded-words.
// We accumulate whole UTF-8 characters so a multi-byte char is never split
// across words, and cap each word so it stays within RFC 2047's 75-char limit.
export function encodeHeaderValue(s) {
  if (isAscii(s)) return s;
  const enc = new TextEncoder();
  const words = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    words.push('=?UTF-8?B?' + btoa(bin) + '?=');
    buf = [];
  };
  for (const ch of Array.from(s)) {
    const bytes = Array.from(enc.encode(ch));
    if (buf.length + bytes.length > 45) flush(); // 45 bytes → ≤60 base64 chars → word ≤72
    for (const b of bytes) buf.push(b);
  }
  flush();
  return words.join('\r\n '); // fold multiple encoded-words with a space
}

// Encode a single address. If it has a display name ("Name <email>") we encode
// only the name and leave the address untouched; a bare address is returned
// as-is.
export function encodeAddress(addr) {
  const m = String(addr).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return addr; // bare "email@host" — nothing to encode
  const name = m[1].replace(/^"|"$/g, '');
  if (!name || isAscii(name)) return addr;
  return encodeHeaderValue(name) + ' <' + m[2] + '>';
}
