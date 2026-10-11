// E-signature links carry the signer's one-time token in the URL fragment
// (sign.html#t=...). Whoever holds that link can sign as that person, which
// is why agreement-sign keeps it out of every server log. An email body that
// gets stored — in email_log, which every staff member can read — must not
// carry it either, so the link is replaced before the text is saved.

const SIGN_LINK = /https?:\/\/[^\s"'<>()]*sign\.html#t=[^\s"'<>()]+/gi;

export function redactSignLinks(text: string): string {
  return String(text || '').replace(SIGN_LINK, '[personal signing link]');
}
