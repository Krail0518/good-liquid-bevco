#!/usr/bin/env node
/* ============================================================================
   BULK EMAIL GUARD — AI drafts sent without review must not carry a stranger's
   links, addresses or numbers (GL-104)
   ----------------------------------------------------------------------------
   Bulk Outreach and Bulk Nudge draft one email per lead with AI and send it with
   no human in between. The lead's own message — typed by anyone into the public
   quote form, along with the address the mail goes to — was pasted into that
   prompt verbatim. A stranger could make Good Liquid mail a third party content
   they steered, signed as Mike, from our domain.

   This test proves three things: the lead's text is fenced as data, every bulk
   send is preceded by the draft check, and the check itself holds the drafts it
   should while letting our own details through.

   Run:  node tests/bulk-email-guard.test.cjs
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const core = fs.readFileSync(path.join(__dirname, '..', 'crm-index-core.js'), 'utf8');
let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + detail);
}

// 1. Lead text is fenced, not interpolated raw.
check('bulk prompts fence the lead\'s message as data',
  core.includes("glLeadTextForPrompt('Their message', d.notes)") &&
  core.includes("glLeadTextForPrompt('Their original message', d.notes)") &&
  !/'Their (original )?message: "'\+d\.notes\+'"'/.test(core),
  'raw d.notes in a bulk prompt lets a lead steer an unreviewed email');

// 2. Every unreviewed bulk send is preceded by the draft check.
const bulkSends = [...core.matchAll(/var ok = await sendMailgunEmail\(d\.email, subject, body, \{ bcc: 'mike@goodliquid\.com', html: htmlBody \}\);/g)];
check('the scan still finds both bulk sends', bulkSends.length === 2, 'found ' + bulkSends.length);
check('each bulk send is gated by glBulkDraftProblem',
  bulkSends.every(m => /var heldFor = glBulkDraftProblem\(subject, body\);[\s\S]{0,900}$/.test(core.slice(Math.max(0, m.index - 900), m.index))),
  'an AI draft could be mailed without the check');
check('Bulk Outreach asks before sending',
  /Draft with AI and email ' \+ checked\.length/.test(core),
  'one click emailed every selected lead');

// 3. The check behaves.
const fnSrc = (core.match(/function glBulkDraftProblem\(subject, body\)\{[\s\S]*?\n\}/) || [''])[0];
check('glBulkDraftProblem exists', !!fnSrc);
if (fnSrc) {
  const f = new Function(fnSrc + '; return glBulkDraftProblem;')();
  const held = [
    ['Hi', 'Details at https://evil.example/pay'],
    ['Hi', 'Reply to billing@evil.co with your card'],
    ['Hi', 'Call my assistant at 555-123-4567'],
    ['Hi', 'See bit.ly/abc for the deck'],
    ['Visit www.example.org', 'Hi there'],
  ];
  const allowed = [
    ['Following up', 'Call me at (803) 493-5065 or Mike@GoodLiquid.com — goodliquidbevco.com'],
    ['Quote', 'We run from 200 cases at $0.28/can in 12oz cans, Palmetto, FL 34221. Timeline about 8 weeks.'],
  ];
  held.forEach(([s, b]) => check('holds: ' + b.slice(0, 40), !!f(s, b)));
  allowed.forEach(([s, b]) => check('allows: ' + b.slice(0, 40), f(s, b) === '', 'got: ' + f(s, b)));
}

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
