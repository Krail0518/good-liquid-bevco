/*
 * inbound-alert-gaps.test.mjs — four ways an inbound event reached Mike
 * wrong, late or not at all (2026-10-12):
 *
 *   C  A public tour request alerted twice: the bookings insert trigger sent
 *      "TOUR BOOKED" for a row that was only 'pending', and booking-confirm's
 *      useful 'tour_requested' (with the Approve/Decline link) was
 *      fire-and-forget, sent with an env secret notify-deal no longer accepts.
 *   D  gmail-sync's content dedup ignored direction, so a client's reply
 *      within 10 minutes of Mike's email in the same thread was taken for
 *      Mike's email: never imported, never alerted.
 *   E  agreement-sign never told Mike an agreement was signed or declined,
 *      and the decline writes were unchecked (success claimed on 0 rows).
 *   F  trigger_notify_new_quote never sent volume (or the message), so the
 *      quote alert always read "Volume: —".
 *
 * The pure logic is imported from THE SAME modules the edge functions run;
 * the wiring is checked statically. The SQL was verified on production in a
 * rolled-back transaction (see the PR description).
 *
 * Run: node tests/inbound-alert-gaps.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  quoteRequestMessage, agreementSignedMessage, agreementDeclinedMessage,
} from '../supabase/functions/_shared/inbound-alarms.mjs';
import {
  sameEmail, findExistingEmail, normSubject, isGmailId,
} from '../supabase/functions/_shared/email-dedup.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

console.log('inbound alert gaps\n');

// ── D: gmail-sync dedup ─────────────────────────────────────────────────────
{
  const T0 = Date.parse('2026-10-12T14:00:00Z');
  const at = (min) => new Date(T0 + min * 60000).toISOString();
  const CLIENT = 'buyer@brandco.com';

  // Mike's outbound, already in email_log from an earlier sync (Gmail id).
  const mikeOut = {
    id: 'row-1', direction: 'outbound', from_email: null, to_email: CLIENT,
    subject: 'Pricing for 5,000 cases', sent_at: at(0), mailgun_id: '18f2a6b0c1d2e3f4', body_preview: 'Here is pricing',
  };
  // The client's reply 3 minutes later, as gmail-sync reads it now.
  const clientReply = {
    direction: 'inbound', from_email: CLIENT, to_email: 'mike@goodliquid.com',
    subject: 'Re: Pricing for 5,000 cases', sent_at: at(3), mailgun_id: '18f2a6b0c1d2e3f9',
  };

  // 1. The same message re-synced: dup (by id).
  const resync = { ...mikeOut, id: undefined };
  const byId = new Map([[mikeOut.mailgun_id, { id: mikeOut.id, body: mikeOut.body_preview }]]);
  ok('same message re-synced is a duplicate (Gmail id already stored)',
    !!findExistingEmail(resync, byId, [mikeOut]));
  ok('same message re-synced is a duplicate by content too', sameEmail(resync, mikeOut));

  // 2. THE BUG: Mike's outbound + the client's reply 3 minutes later.
  ok('client reply 3 min after Mike\'s email is NOT a duplicate',
    findExistingEmail(clientReply, new Map(), [mikeOut]) === null);
  ok('...even when Mike\'s row has no Gmail id (CRM-logged), direction alone separates them',
    findExistingEmail({ ...clientReply }, new Map(), [{ ...mikeOut, mailgun_id: null }]) === null);
  ok('...and even when the reply has no id, direction alone separates them',
    !sameEmail({ ...clientReply, mailgun_id: '' }, { ...mikeOut, mailgun_id: null }));

  // 3. A CRM-logged outbound (no Gmail id stored) and its Gmail copy: dup.
  const crmLogged = { id: 'row-2', direction: 'outbound', from_email: null, to_email: CLIENT,
    subject: 'Invoice GL-1042', sent_at: at(0), mailgun_id: null };
  const gmailCopy = { direction: 'outbound', from_email: null, to_email: CLIENT,
    subject: 'Invoice GL-1042', sent_at: at(1), mailgun_id: '18f2a6b0c1d2e3aa' };
  ok('CRM-logged outbound + its Gmail copy IS a duplicate',
    findExistingEmail(gmailCopy, new Map(), [crmLogged]) === crmLogged);
  ok('...also when the CRM stored a non-Gmail (Mailgun) id',
    !!findExistingEmail(gmailCopy, new Map(), [{ ...crmLogged, mailgun_id: '<20261012.abc@mail.goodliquidbevco.com>' }]));
  ok('...and an old row without a direction still dedups',
    !!findExistingEmail(gmailCopy, new Map(), [{ ...crmLogged, direction: null }]));

  // 4. Two different client emails in a row (same thread, same direction).
  const second = { ...clientReply, mailgun_id: '18f2a6b0c1d2e400', sent_at: at(5) };
  ok('two different Gmail messages from the client are NOT duplicates',
    !sameEmail(second, { ...clientReply, id: 'row-3' }));

  // Boundaries the old rules kept.
  ok('outside the 10-minute window: not a duplicate', !sameEmail({ ...gmailCopy, sent_at: at(11) }, crmLogged));
  ok('different subject: not a duplicate', !sameEmail({ ...gmailCopy, subject: 'Something else' }, crmLogged));
  ok('different contact: not a duplicate', !sameEmail({ ...gmailCopy, to_email: 'other@x.com' }, crmLogged));
  ok('normSubject strips Re:/Fwd:', normSubject('  RE: Fwd:  Hello   there ') === 'hello there');
  ok('isGmailId', isGmailId('18f2a6b0c1d2e3f4') && !isGmailId('<abc@mail>') && !isGmailId(null));
}

// ── E: agreement messages ───────────────────────────────────────────────────
{
  const leak = 'https://www.goodliquidbevco.com/sign.html#t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
  const s = agreementSignedMessage({
    title: 'Mutual NDA', party: 'BrandCo LLC',
    signers: 'Jane Buyer (Company), Mike Krail (Good Liquid)', filed: 'yes',
  });
  ok('signed: chat names the agreement and the party', /AGREEMENT SIGNED: "Mutual NDA" with BrandCo LLC/.test(s.short), s.short);
  ok('signed: email lists the signers', /Signed by: Jane Buyer \(Company\), Mike Krail \(Good Liquid\)/.test(s.body));
  ok('signed: subject', s.subject === '✍️ Signed: Mutual NDA (BrandCo LLC)', s.subject);
  ok('signed: no warning when filed', !/NOT filed/.test(s.short));
  const sf = agreementSignedMessage({ title: 'Mutual NDA', party: 'BrandCo LLC', filed: 'no', filed_error: 'PDF upload failed' });
  ok('signed: warns when the PDF was not filed', /NOT filed: PDF upload failed/.test(sf.short) && /could NOT be filed/.test(sf.body));

  const d = agreementDeclinedMessage({
    title: 'Manufacturing Agreement', party: 'BrandCo LLC', signer: 'Jane Buyer',
    signer_email: 'jane@brandco.com', role: 'client', reason: 'Price too high. ' + leak,
  });
  ok('declined: chat says who declined what', /AGREEMENT DECLINED: Jane Buyer \(jane@brandco\.com\) declined "Manufacturing Agreement" with BrandCo LLC/.test(d.short), d.short);
  ok('declined: carries the reason', /Reason: Price too high\./.test(d.short) && /Price too high\./.test(d.body));
  ok('declined: labels the client side', /Client signer: Jane Buyer <jane@brandco\.com>/.test(d.body));
  ok('declined: NEVER carries a signing link', ![d.short, d.body, d.subject].some((t) => /sign\.html#t=/.test(t)));
  ok('declined: no reason given', /Reason: none given/.test(agreementDeclinedMessage({ title: 'X' }).short));
  ok('signed: NEVER carries a signing link', ![s.short, s.body].some((t) => /sign\.html/.test(t)) &&
    !/sign\.html#t=/.test(agreementSignedMessage({ title: 'NDA ' + leak }).short));
}

// ── F: quote message ────────────────────────────────────────────────────────
{
  const q = quoteRequestMessage({
    name: 'Jane Buyer', company: 'BrandCo', email: 'jane@brandco.com', phone: '555-0100',
    service: 'Co-packing', volume: '5,000 cases', message: 'Need a 12oz can run in March.',
  });
  ok('quote: email shows the volume', /Volume:  5,000 cases/.test(q.body), q.body);
  ok('quote: chat shows the volume', /Volume: 5,000 cases\./.test(q.short), q.short);
  ok('quote: shows the customer message', /Need a 12oz can run in March\./.test(q.body) && /Need a 12oz/.test(q.short));
  ok('quote: keeps brand/contact/email/phone/service', /Brand:   BrandCo/.test(q.body) && /Contact: Jane Buyer/.test(q.body) &&
    /Email:   jane@brandco\.com/.test(q.body) && /Phone:   555-0100/.test(q.body) && /Service: Co-packing/.test(q.body));
  ok('quote: subject unchanged', q.subject === '📩 New quote: BrandCo');
  const empty = quoteRequestMessage({ company: 'BrandCo' });
  ok('quote: missing volume still renders a dash', /Volume:  —/.test(empty.body) && /Volume: not given/.test(empty.short));
}

// ── Wiring (static) ─────────────────────────────────────────────────────────
{
  const nd = read('supabase/functions/notify-deal/index.ts');
  ok('notify-deal: new_quote uses quoteRequestMessage', /event === 'new_quote'[\s\S]{0,80}quoteRequestMessage\(data\)/.test(nd));
  ok('notify-deal: agreement_signed / agreement_declined events',
    /event === 'agreement_signed'[\s\S]{0,80}agreementSignedMessage\(data\)/.test(nd) &&
    /event === 'agreement_declined'[\s\S]{0,80}agreementDeclinedMessage\(data\)/.test(nd));

  const notify = read('supabase/functions/_shared/notify.ts');
  ok('notify helper: Vault secret first (matches notify-deal)', /\(await vaultGet\('gl_notify_secret'\)\) \|\| Deno\.env\.get\('GL_NOTIFY_SECRET'\)/.test(notify));
  ok('notify helper: awaits the call with a timeout', /await fetch\([\s\S]{0,300}AbortSignal\.timeout/.test(notify));

  const bc = read('supabase/functions/booking-confirm/index.ts');
  ok('booking-confirm: tour_requested is awaited', /await notifyDeal\('booking-confirm', 'tour_requested'/.test(bc));
  ok('booking-confirm: no fire-and-forget notify-deal fetch', !/functions\/v1\/notify-deal/.test(bc) && !/\.catch\(\(\) => \{\}\)/.test(bc));
  ok('booking-confirm: still sends the review link', /review_url: reviewUrl/.test(bc));

  const as = read('supabase/functions/agreement-sign/index.ts');
  ok('agreement-sign: alerts when complete', /await notifyDeal\('agreement-sign', 'agreement_signed'/.test(as));
  ok('agreement-sign: alerts on decline', /await notifyDeal\('agreement-sign', 'agreement_declined'/.test(as));
  ok('agreement-sign: keeps the decline email to the GL signer', /gl_signer_email[\s\S]{0,400}Declined: \$\{agreement\.title\}/.test(as));
  const dec = as.slice(as.indexOf("if (action === 'decline')"), as.indexOf('// sign\n') > 0 ? as.indexOf('// sign\n') : as.indexOf('// sign\r\n'));
  ok('agreement-sign: decline signer update is checked', /sUpd\.error \|\| !sUpd\.data\?\.length\)[\s\S]{0,200}return errorResponse/.test(dec));
  ok('agreement-sign: decline agreement update is checked', /aUpd\.error \|\| !aUpd\.data\?\.length\)[\s\S]{0,200}return errorResponse/.test(dec));
  const updates = dec.match(/\.update\(/g) || [];
  const checkedUpdates = dec.match(/const (\w+) = await sb\.from\('[a-z_]+'\)\.update\([\s\S]*?\.select\('id'\);\s+if \(\1\.error \|\| !\1\.data\?\.length\)/g) || [];
  ok('agreement-sign: every decline update is checked (error and empty)',
    updates.length === 3 && checkedUpdates.length === 3, updates.length + ' updates, ' + checkedUpdates.length + ' checked');
  const alertArgs = [...as.matchAll(/notifyDeal\('agreement-sign',[\s\S]*?\}\);/g)].map((m) => m[0]).join('\n');
  ok('agreement-sign: alerts carry no token or link', alertArgs.length > 0 && !/token|link|SITE_URL/i.test(alertArgs), alertArgs);

  const gs = read('supabase/functions/gmail-sync/index.ts');
  ok('gmail-sync: uses the tested dedup module', /from '\.\.\/_shared\/email-dedup\.mjs'/.test(gs) && /findExistingEmail\(c, null, priorRows\)/.test(gs));
  ok('gmail-sync: prior rows carry direction and Gmail id', /\.select\('id, subject, to_email, from_email, direction, mailgun_id,/.test(gs));
  ok('gmail-sync: no inline direction-blind matcher left', !/Direction is intentionally not compared/.test(gs));

  const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /_inbound_alert_gaps\.sql$/.test(f));
  ok('migration exists', files.length === 1);
  const sql = files.length ? read('supabase/migrations/' + files[0]) : '';
  ok('migration: ROLLBACK note at the top', /^[\s\S]{0,400}ROLLBACK:/.test(sql));
  ok('migration: tour trigger skips non-confirmed (pending) rows',
    /trigger_notify_tour_booked\(\)[\s\S]{0,400}if coalesce\(new\.status, 'confirmed'\) <> 'confirmed' then\s+return new;/.test(sql));
  ok('migration: quote trigger sends volume and message',
    /'volume',\s+coalesce\(new\.volume, ''\)/.test(sql) && /'message', left\(coalesce\(new\.message, ''\), 2000\)/.test(sql));
  for (const fn of ['trigger_notify_new_quote', 'trigger_notify_tour_booked']) {
    ok(`migration: ${fn} is SECURITY DEFINER with a pinned search_path`,
      new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]{0,120}security definer\\s+set search_path = public, pg_temp`).test(sql));
    ok(`migration: ${fn} not executable by anon/authenticated`,
      new RegExp(`revoke all on function public\\.${fn}\\(\\)\\s+from public, anon, authenticated`).test(sql));
  }
  ok('migration: secret read from Vault, not embedded', /vault\.decrypted_secrets/.test(sql) && !/'secret',\s+'[^']/.test(sql));
  ok('migration: no USING (true)', !/using\s*\(\s*true\s*\)/i.test(sql));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
