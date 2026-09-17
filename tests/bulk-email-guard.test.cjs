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

   GL-105 added the real fix, a review step: the bulk tools only draft, and every
   send goes through glBulkReview, which mails only drafts a person approved,
   exactly as edited. This test proves the lead's text is fenced as data, that
   no bulk tool sends directly, that the reviewer sends only approved drafts,
   and that the flagging check holds what it should while letting ours through.

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

// 2. GL-105: the bulk tools only DRAFT. Every send happens in glBulkReview,
//    and only for drafts a person approved.
const fnBody = (name, next) => {
  const i = core.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
  if (i < 0) return '';
  const j = core.indexOf('\nwindow.' + name + ' = ' + name + ';', i);
  return core.slice(i, j < 0 ? i + 20000 : j);
};
const outreach = fnBody('openBulkOutreach');
const nudge = fnBody('glOpenBulkNudge');
const review = fnBody('glBulkReview');
check('both bulk tools and the reviewer were found', !!outreach && !!nudge && !!review,
  'outreach=' + !!outreach + ' nudge=' + !!nudge + ' review=' + !!review);
check('neither bulk tool sends email itself',
  !/sendMailgunEmail\(/.test(outreach) && !/sendMailgunEmail\(/.test(nudge),
  'a bulk tool mailed an AI draft that no person had read');
check('both bulk tools hand their drafts to the reviewer',
  /glBulkReview\(\{/.test(outreach) && /glBulkReview\(\{/.test(nudge));
check('the reviewer sends only approved, unsent drafts, as edited',
  /var approved = items\.filter\(function\(it\)\{ return !it\._sent && it\._ui\.chk\.checked; \}\);/.test(review) &&
  /sendMailgunEmail\(it\.to, subject, text, /.test(review) &&
  /var subject = it\._ui\.subj\.value\.trim\(\);/.test(review) &&
  (review.match(/sendMailgunEmail\(/g) || []).length === 1,
  'the reviewer must send what the person approved and edited, nothing else');
check('flagged drafts start unapproved',
  /chk\.checked = !it\.heldFor;/.test(review) &&
  /heldFor: flag \}\);/.test(outreach) && /heldFor: flag \}\);/.test(nudge));
check('the reviewer builds its UI without innerHTML (drafts are AI output shaped by leads)',
  !/innerHTML/.test(review));
check('the email HTML escapes the approved body',
  /function glBulkEmailHtml\(body\)\{\s*var safe = String\(body \|\| ''\)\.replace\(\/\[&<>'"\]\/g/.test(core));

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
