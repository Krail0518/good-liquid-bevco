/*
 * sales-deck.test.mjs — the automatic sales-deck email to website leads.
 *
 * Imports THE SAME module the quote-decks edge function runs
 * (supabase/functions/_shared/sales-deck.mjs) and checks:
 *   - the approved email text, and that lead-typed values are escaped in HTML
 *   - once per prospect (deal stamp, earlier email to the same address)
 *   - the deck picker never sends another client's confidential pricing
 *   - the deck_send_failed alert text
 * plus static checks that the function, notify-deal, config.toml and the
 * migration are wired the way the design depends on.
 *
 * The SQL was verified against production inside rolled-back transactions;
 * see the PR description.
 *
 * Run: node tests/sales-deck.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deckEmail, firstName, deckSendDecision, pickSendableDeck, deckSendFailedMessage,
  isQuoteRequestDeal, normWords, MAX_DECK_BYTES,
} from '../supabase/functions/_shared/sales-deck.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

console.log('sales deck — approved email, once per prospect, never the wrong deck\n');

// ── The approved email ─────────────────────────────────────────────
const m = deckEmail({ contact_name: 'Ann Avery', client_name: 'Acme Sparkling Co' });
ok('subject is the approved subject', m.subject === 'Good Liquid Bev Co — capabilities and pricing', m.subject);
ok('plain text is the approved body, verbatim',
  m.text === 'Hi Ann,\n\nThank you for reaching out about Acme Sparkling Co. Attached is our capabilities and pricing deck so you can see how we work, our minimums and our rate card. We will follow up within one business day to talk through your project.\n\nMike Krail\nGood Liquid Bev Co',
  JSON.stringify(m.text));
ok('HTML carries the same words', /Hi Ann,/.test(m.html) && /about Acme Sparkling Co\./.test(m.html) && /Mike Krail<br>Good Liquid Bev Co/.test(m.html));

ok('first name = first word', firstName('Ann Avery') === 'Ann');
ok('no contact name → "there"', firstName('') === 'there' && firstName(null) === 'there' && firstName('   ') === 'there');
ok('punctuation-only name → "there"', firstName('!!! ???') === 'there');
ok('trailing comma dropped', firstName('Ann, CEO') === 'Ann', firstName('Ann, CEO'));
ok('all-lowercase name is capitalised', firstName('john smith') === 'John');
ok('mixed-case name is kept as typed', firstName('DeShawn Lee') === 'DeShawn' && firstName('McKenzie') === 'McKenzie');
ok('accented names survive', firstName('José García') === 'José');
ok('very long first word is clipped', firstName('A'.repeat(300)).length <= 40);
ok('no brand → "your brand"', /reaching out about your brand\./.test(deckEmail({ contact_name: 'Ann' }).text));

const hostile = deckEmail({
  contact_name: '<img src=x onerror=alert(1)> Evil',
  client_name: '"><script>alert(2)</script>&amp; Co\'s',
});
ok('HTML: lead-typed brand cannot open a tag', !/<script/i.test(hostile.html) && !/<img/i.test(hostile.html), hostile.html);
ok('HTML: & is escaped (no entity smuggling)', /&amp;amp;/.test(hostile.html));
ok('HTML: quotes are escaped', !/"><script/.test(hostile.html) && /&quot;&gt;&lt;script/.test(hostile.html));
ok('a name that is only punctuation/markup falls back to "there"', /^Hi there,/.test(deckEmail({ contact_name: '<<< >>>' }).text));
ok('HTML: a markup-shaped name is text, not a tag', /^<div[^>]*><p[^>]*>Hi Img,<\/p>/.test(hostile.html), hostile.html.slice(0, 160));
ok('plain text keeps the brand as typed (it is text/plain, not markup)', hostile.text.includes('"><script>alert(2)</script>'));
const nl = deckEmail({ contact_name: 'Ann\r\nBcc: x@evil.test', client_name: 'Acme\r\nBcc: y@evil.test' });
ok('newlines in lead values are flattened', !/\r|\nBcc/.test(nl.text.split('\n\n')[1]) && /^Hi Ann,/.test(nl.text), JSON.stringify(nl.text.slice(0, 120)));
ok('the subject never contains lead input', deckEmail({ client_name: 'X\nBcc: z@evil.test' }).subject === m.subject);

// ── Once per prospect ──────────────────────────────────────────────
const deal = { id: 'd1', name: 'Acme Sparkling Co — Quote Request', email: 'ann@acme.test', contact_name: 'Ann', client_name: 'Acme Sparkling Co', deck_sent_at: null };
ok('a fresh website quote request is sent', deckSendDecision(deal, null).send === true);
ok('missing deal is skipped', deckSendDecision(null, null).send === false);
ok('a deal not from the website form is skipped',
  deckSendDecision({ ...deal, name: 'Acme Sparkling Co' }, null).reason === 'not a website quote request');
ok('isQuoteRequestDeal needs the exact suffix', isQuoteRequestDeal(deal) && !isQuoteRequestDeal({ name: 'Quote Request for Acme' }) && !isQuoteRequestDeal({}));
ok('no email → skipped', deckSendDecision({ ...deal, email: null }, null).reason === 'no valid email on the deal');
ok('malformed email → skipped', deckSendDecision({ ...deal, email: 'not an email' }, null).send === false);
ok('deal already stamped → skipped (repeat request on the same open deal)',
  deckSendDecision({ ...deal, deck_sent_at: '2026-10-12T00:00:00Z' }, null).reason === 'deck already sent to this deal');
ok('same address already emailed from another deal → skipped',
  deckSendDecision(deal, '2026-10-01T00:00:00Z').reason === 'deck already sent to this email address');

// ── Which deck ─────────────────────────────────────────────────────
// Production rows as of 2026-10-12, plus the real client name with its
// double space ("Lotus  nutra").
const GL = { id: 'g', key: 'good_liquid_capabilities', label: 'Good Liquid capabilities & pricing deck', filename: 'Good Liquid Bev Co - Capabilities and Pricing.pdf', storage_path: 'good_liquid_capabilities/deck.pdf', active: true, auto_send: true, sort_order: 10 };
const LOTUS = { id: 'l', key: 'lotus_nutra_pricing', label: 'Lotus Nutra R&D pricing (confidential)', filename: 'Lotus Nutra - R&D Pricing.pdf', storage_path: 'lotus_nutra_pricing/x.pdf', active: true, auto_send: false, sort_order: 20 };
const CLIENTS = ['Acme Sparkling Co', 'Lotus  nutra', 'Good Liquid Bev Co', 'Ox'];

let p = pickSendableDeck([GL, LOTUS], CLIENTS);
ok('picks the Good Liquid deck', p.deck && p.deck.key === 'good_liquid_capabilities' && !p.refused.length, JSON.stringify(p));

p = pickSendableDeck([{ ...GL, auto_send: false }, { ...LOTUS, auto_send: true }], CLIENTS);
ok('Lotus pricing with auto_send ON is still refused', !p.deck && p.refused.length === 1 && p.refused[0].key === 'lotus_nutra_pricing', JSON.stringify(p));

p = pickSendableDeck([{ ...LOTUS, auto_send: true, label: 'Lotus Nutra R&D pricing' }], CLIENTS);
ok('…even with "confidential" removed from the label, because it names a client',
  !p.deck && /names a client \(lotus nutra\)/.test((p.refused[0] || {}).reason || ''), JSON.stringify(p));

p = pickSendableDeck([{ ...GL, key: 'deck2', label: 'Pricing (CONFIDENTIAL)', filename: 'x.pdf' }], []);
ok('"confidential" in any case is refused', !p.deck && p.refused.length === 1);

p = pickSendableDeck([{ ...GL, key: 'acme_sparkling_co_rates', label: 'Rates', filename: 'rates.pdf' }], CLIENTS);
ok('a client name in the KEY is caught (underscores are word breaks)', !p.deck && p.refused.length === 1, JSON.stringify(p));

p = pickSendableDeck([GL], CLIENTS);
ok('Good Liquid\'s own name does not count as "another client"', !!p.deck);
ok('short client names (< 4 letters) do not cause false refusals', !!pickSendableDeck([{ ...GL, label: 'Ox-free pricing deck' }], ['Ox']).deck);
ok('client names match whole words only', !!pickSendableDeck([GL], ['Liquid Cap']).deck && !!pickSendableDeck([GL], ['Pricing Co']).deck);

p = pickSendableDeck([{ ...GL, active: false }], CLIENTS);
ok('inactive deck is never sent', !p.deck && !p.missing);
p = pickSendableDeck([{ ...GL, storage_path: null }], CLIENTS);
ok('no PDF uploaded → nothing sent, flagged missing', !p.deck && p.missing === true);
p = pickSendableDeck([], CLIENTS);
ok('nothing set to auto-send → nothing sent, not "missing"', !p.deck && !p.missing && !p.refused.length);
p = pickSendableDeck([{ ...GL, auto_send: 'true' }], []);
ok('auto_send must be boolean true (no truthy strings)', !p.deck);
ok('normWords folds spacing, case and punctuation', normWords('Lotus  nutra') === 'lotus nutra' && normWords('lotus_nutra_pricing') === 'lotus nutra pricing');

// ── The failure alert ──────────────────────────────────────────────
const a = deckSendFailedMessage({ company: 'Acme', name: 'Ann', email: 'ann@acme.test', reason: 'gmail-send answered 500' });
ok('alert names the lead, the address and the reason', /Acme/.test(a.short) && /ann@acme\.test/.test(a.short) && /gmail-send answered 500/.test(a.short));
ok('alert says where to fix it', /Sales Decks/.test(a.body));
ok('alert subject is one line', !/\n/.test(a.subject) && /Sales deck not sent: Acme/.test(a.subject));
ok('alert with nothing still reads sensibly', /a website lead/.test(deckSendFailedMessage({}).short) && /unknown error/.test(deckSendFailedMessage({}).short));
ok('alert flattens newlines in lead values', !/\n/.test(deckSendFailedMessage({ company: 'A\nB' }).subject));
ok('attachment cap is 15 MB', MAX_DECK_BYTES === 15 * 1024 * 1024);

// ── Wiring ─────────────────────────────────────────────────────────
const fn = read('supabase/functions/quote-decks/index.ts');
const nd = read('supabase/functions/notify-deal/index.ts');
const cfg = read('supabase/config.toml');
const mig = read('supabase/migrations/20261012050000_quote_decks.sql');
const ui = read('src/modules/pipeline/sales-decks.js');

ok('quote-decks imports the tested module', /from '\.\.\/_shared\/sales-deck\.mjs'/.test(fn));
ok('quote-decks checks the secret before reading any data',
  (() => { const srv = fn.slice(fn.indexOf('Deno.serve(')); const a = srv.indexOf('sameSecret(String(body.secret'); return a > 0 && a < srv.indexOf('.from(') && a < srv.indexOf('.storage'); })());
ok('a bad secret is a 401', /sameSecret\(String\(body\.secret[\s\S]{0,120}?401/.test(fn));
ok('the deal is claimed with a conditional, checked update',
  /update\(\{ deck_sent_at: claimedAt \}\)[\s\S]{0,120}?\.is\('deck_sent_at', null\)\.select\('id'\)/.test(fn) &&
  /if \(!claim\.data\?\.length\)/.test(fn));
ok('a failed send releases the claim and alerts Mike',
  /const fail = async[\s\S]{0,300}?releaseClaim\([\s\S]{0,120}?alertMike\(/.test(fn));
ok('the gmail-send result is checked', /if \(!r\.ok \|\| j\.ok !== true\)/.test(fn) && /if \(!sent\.ok\) return fail\(/.test(fn));
ok('the hourly cap fails closed', /checkRateLimit\('quote-decks:send', SEND_CAP_PER_HOUR, 3600, \{ onOutage: 'closed' \}\)/.test(fn));
ok('the "no deck uploaded" alert repeats at most once a day', /key: 'no-deck', seconds: 86400/.test(fn));
ok('sends are logged to email_log as sales_deck, outbound, sent, client_id null',
  /template_name: DECK_TEMPLATE, client_id: null, direction: 'outbound', status: 'sent'/.test(fn) && /mailgun_id: sent\.id/.test(fn));
ok('notify-deal renders deck_send_failed from the tested module',
  /import \{ deckSendFailedMessage \} from '\.\.\/_shared\/sales-deck\.mjs'/.test(nd) && /event === 'deck_send_failed'/.test(nd));
ok('config.toml declares quote-decks with the gateway check on', /\[functions\.quote-decks\]\nverify_jwt = true/.test(cfg));

ok('migration has a ROLLBACK note', /^-- ROLLBACK:/m.test(mig));
ok('migration turns auto_send on ONLY for good_liquid_capabilities',
  /set auto_send = true  where key =  'good_liquid_capabilities'/.test(mig) &&
  /set auto_send = false where key <> 'good_liquid_capabilities'/.test(mig) &&
  (mig.match(/set auto_send = true/g) || []).length === 1);
ok('at most one auto-send deck (partial unique index)', /create unique index if not exists sales_decks_one_auto_send[\s\S]{0,80}where auto_send/.test(mig));
ok('deck changes are admin-only (restrictive, table and bucket)',
  /"sales_decks admin update" on public\.sales_decks\s+as restrictive/.test(mig) &&
  /"sales-decks admin writes \(insert\)" on storage\.objects\s+as restrictive/.test(mig) &&
  /"sales-decks admin writes \(update\)" on storage\.objects\s+as restrictive/.test(mig));
ok('no permissive USING (true) anywhere', !/using\s*\(\s*true\s*\)/i.test(mig) && !/with check\s*\(\s*true\s*\)/i.test(mig));
ok('the dispatch now sends an Authorization bearer', /gl_dispatch_quote_decks[\s\S]*'Authorization', 'Bearer ey/.test(mig) && /headers := v_headers/.test(mig));
ok('the dispatch stays service_role-only',
  /revoke all on function public\.gl_dispatch_quote_decks\(uuid\) from public, anon, authenticated;/.test(mig) &&
  /grant execute on function public\.gl_dispatch_quote_decks\(uuid\) to service_role;/.test(mig));

const la = read('supabase/functions/lead-automations/index.ts');
const corr = read('src/shared/correspondence.js');
ok('the deck email is not counted as Mike\'s first reply (server SLA watchdog)',
  la.includes("const AUTOMATED_TEMPLATES = new Set(['sales_deck']);") &&
  la.includes('for (const m of mail) {\n    if (m.template_name && AUTOMATED_TEMPLATES.has(m.template_name)) continue;') &&
  la.includes("body_preview, template_name')"));
ok('the CRM outreach index ignores the deck email ("awaiting reply" badge stays)',
  corr.includes("if(row.template_name === 'sales_deck') return;") && corr.includes("sent_at, created_at, template_name')"));
ok('CRM upload enforces the same 15 MB cap', /MAX_BYTES = 15 \* 1024 \* 1024/.test(ui));
ok('CRM screen is admin-gated', /function isAdmin\(\)/.test(ui) && /if\(!isAdmin\(\)\)/.test(ui));
ok('CRM screen has no innerHTML (text goes in with textContent)', !/\.innerHTML\s*=|insertAdjacentHTML/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')));
ok('CRM writes are checked (.select + empty check)', (ui.match(/\.update\(/g) || []).length === (ui.match(/\.update\([^;]*?\.select\(/g) || []).length);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
