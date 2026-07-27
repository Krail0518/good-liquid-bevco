/*
 * email-text.test.mjs — unit tests for the mail-pipeline text logic.
 *
 * These cover the bugs the owner actually hit, and they import the SAME modules
 * the deployed edge functions import, so a regression here cannot pass by
 * drifting from a copy:
 *
 *   - garbled invoice subject ("Ã¢Â€Â" where an em dash belonged)
 *   - synced emails stored as Gmail's ~200-char snippet instead of the body
 *   - "you&#39;re" / "&gt; wrote:" entity codes leaking into stored text
 *   - a three-line reply stored with 900 characters of quoted thread attached
 *
 * Run: node tests/email-text.test.mjs
 */
import {
  decodeEntities, extractBody, hasReplyTail, htmlToText, trimToNewMessage,
} from '../supabase/functions/_shared/email-text.mjs';
import { encodeHeaderValue, encodeAddress, isAscii } from '../supabase/functions/_shared/mime-headers.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n         want ' + JSON.stringify(want) + '\n          got ' + JSON.stringify(got)); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const b64u = (t) => Buffer.from(t, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('\n── MIME header encoding (the garbled subject bug)');
{
  const subj = 'Invoice GL-1018 from Good Liquid Bev Co — $2,425.00';
  const enc = encodeHeaderValue(subj);
  ok('em-dash subject gets encoded', /^=\?UTF-8\?B\?/.test(enc), enc);
  const dec = enc.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_m, b) => Buffer.from(b, 'base64').toString('utf8')).replace(/\r\n /g, '');
  eq('round-trips back to the original', dec, subj);
  eq('pure ASCII passes through untouched', encodeHeaderValue('Plain ASCII subject'), 'Plain ASCII subject');
  ok('encoded words stay within the 75-char limit',
    enc.split('\r\n ').every(w => w.length <= 75), enc);
  ok('accented name encodes', /^=\?UTF-8\?B\?/.test(encodeHeaderValue('Café Résumé')));
  eq('bare address is left alone', encodeAddress('mike@goodliquid.com'), 'mike@goodliquid.com');
  eq('ASCII display name is left alone', encodeAddress('Mike Krail <mike@goodliquid.com>'), 'Mike Krail <mike@goodliquid.com>');
  ok('non-ASCII display name encodes but keeps the address',
    encodeAddress('Café Owner <a@b.com>').includes('<a@b.com>') &&
    encodeAddress('Café Owner <a@b.com>').startsWith('=?UTF-8?B?'));
  ok('isAscii is honest', isAscii('abc') === true && isAscii('a—b') === false);
}

console.log('\n── Body extraction (snippet-instead-of-body bug)');
{
  const BODY = 'Benjamin,\n\nThanks for reaching out.\n\nBest,\nMike';
  eq('simple text/plain', extractBody({ mimeType: 'text/plain', body: { data: b64u(BODY) } }), BODY);
  eq('multipart/alternative prefers plain over HTML',
    extractBody({ mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: b64u(BODY) } },
      { mimeType: 'text/html',  body: { data: b64u('<p>ignore</p>') } }] }), BODY);
  eq('nested mixed + PDF attachment (the invoice shape)',
    extractBody({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: b64u(BODY) } },
        { mimeType: 'text/html',  body: { data: b64u('<p>x</p>') } }] },
      { mimeType: 'application/pdf', filename: 'inv.pdf', body: { attachmentId: 'x' } }] }), BODY);
  const h = extractBody({ mimeType: 'text/html', body: { data: b64u('<style>p{color:red}</style><p>Hi Ben</p><p>Thanks&nbsp;&amp; regards</p>') } });
  ok('html-only is de-tagged and entity-decoded', h.includes('Hi Ben') && h.includes('Thanks & regards') && !h.includes('<') && !h.includes('color:red'), h);
  eq('UTF-8 survives (accents, em dash, emoji)',
    extractBody({ mimeType: 'text/plain', body: { data: b64u('Café — 100% naturel ✅') } }), 'Café — 100% naturel ✅');
  eq('attachment-only yields nothing so the caller can fall back',
    extractBody({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'application/pdf', body: { attachmentId: 'a' } }] }), '');
  eq('missing payload is safe', extractBody(null), '');
}

console.log('\n── Entity decoding (the "you&#39;re" leak)');
{
  eq('apostrophe', decodeEntities('you&#39;re looking for'), "you're looking for");
  eq('angle brackets', decodeEntities('&lt;mike@goodliquid.com&gt; wrote:'), '<mike@goodliquid.com> wrote:');
  eq('ampersand', decodeEntities('Thanks &amp; regards'), 'Thanks & regards');
  eq('double-escaped stays escaped once', decodeEntities('&amp;lt; literal'), '&lt; literal');
  eq('numeric entity', decodeEntities('Caf&#233; open'), 'Café open');
}

console.log('\n── Quoted-thread trimming (the "gets weird after the message" bug)');
{
  const REAL = `Hey Mike
We got caught up in some things. Here is the pa letter.
Do you have any contract that we need to sign or anything?


Get Outlook for Mac<https://aka.ms/GetOutlookForMac>
From: Michael Krail <mike@goodliquid.com>
Date: Tuesday, July 21, 2026 at 9:11 PM
Subject: Good Liquid × Perico, Co-Packing Quote (3 SKUs)

Hi Erick and Glendys,
Apologize for the late response.

Best,
[photo]
Michael Krail
803-493-5065 | GoodLiquid.com<https://urldefense.proofpoint.com/v2/url?u=https-3A__GoodLiquid.com&d=DwMFaQ&c=euGZstcaTDllvimEN8b7jXrwqOf-v5A_CdpgnVfiiMM&r=_6CbCtrxemGQX&m=0kv717Tq9oLF&s=Ps0XsxrBVm85&e=>
[__tpx__]`;
  const t = trimToNewMessage(REAL);
  ok('keeps every real sentence', t.includes('Hey Mike') && t.includes('pa letter') && t.includes('need to sign'), t);
  ok('drops the client footer', !t.includes('Get Outlook'));
  ok('drops the quoted header block', !t.includes('From: Michael Krail'));
  ok('drops the quoted previous email', !t.includes('Apologize for the late response'));
  ok('drops the Proofpoint link wrapper', !t.includes('urldefense.proofpoint.com'));
  ok('drops image/tracking placeholders', !/\[photo\]|\[__tpx__\]/.test(t));
  // Ratio, not absolute lengths: an absolute bound silently depends on how long
  // this fixture happens to be, and broke when the fixture was shortened.
  ok('cuts the bulk of the message away but does not empty it',
    t.length < REAL.length * 0.4 && t.length > 50,
    REAL.length + ' -> ' + t.length + ' (' + Math.round(100 * t.length / REAL.length) + '% kept)');
  ok('detects a tail in the raw copy', hasReplyTail(REAL) === true);
  ok('no tail left after trimming', hasReplyTail(t) === false);

  const GMAIL_STYLE = `Thanks for the PA letter.

Mike Krail

On Fri, Jul 24, 2026, 2:24 PM Erick Cladera <erick@perico.energy> wrote:
> Hey Mike
> We got caught up in some things.`;
  const g = trimToNewMessage(GMAIL_STYLE);
  ok('cuts at Gmail-style "On ... wrote:"', g.includes('Thanks for the PA letter') && !g.includes('wrote:') && !g.includes('> Hey Mike'), g);

  // Guards against over-trimming — each of these must be returned unchanged.
  eq('short reply untouched', trimToNewMessage('Sounds good, talk Monday.'), 'Sounds good, talk Monday.');
  eq('prose containing "wrote" untouched',
    trimToNewMessage('I wrote the spec yesterday and it looks solid.'),
    'I wrote the spec yesterday and it looks solid.');
  eq('bare "From:" prose untouched',
    trimToNewMessage('From: our supplier we heard the cans ship Friday.'),
    'From: our supplier we heard the cans ship Friday.');
  ok('a message that is only a quote is kept rather than emptied',
    trimToNewMessage('> just this quoted line').length > 0);
}

console.log('\n' + (fail ? 'FAILED — ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
