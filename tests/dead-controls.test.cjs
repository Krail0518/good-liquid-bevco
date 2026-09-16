#!/usr/bin/env node
/* ============================================================================
   DEAD CONTROLS — a button that does nothing, quietly (GL-081, GL-082)
   ----------------------------------------------------------------------------
   WHY THIS EXISTS

   actions.js says it in its own header: "A converted control that silently
   does nothing is the worst outcome here: no console error, no failed request,
   just a dead button." It then guards the one case it can see — an action name
   with no global behind it — and reports that loudly.

   A full click-through of the CRM on 2026-09-16 found two dead controls that
   guard could never have caught, because in both the handler ran perfectly:

   GL-081  Sidebar "AI Tools" (#nav-ai-tools-btn, data-gl-action=
           glAIHubTogglePanel). The dispatcher listens on document; so does
           help-features.js's close-on-outside-click handler for the same
           panel. One click ran both: the toggle opened the panel, and the
           closer — whose exemptions covered the panel and #ai-toolbar but not
           the sidebar item — shut it again. Verified live: calling
           glAIHubTogglePanel() directly moved display none -> flex, while
           clicking the button left it at none.

   GL-082  The quote "Services" editor rendered with BOTH a `hidden` attribute
           and an inline `display:flex`. Inline display outranks the UA
           stylesheet's [hidden]{display:none}, so every panel was permanently
           expanded and the toggle flipped `hidden` underneath with no visible
           effect. Introduced the same day, in phase 4b.

   Both shapes are invisible to a handler-exists check and to any test that
   asserts markup. What they have in common is that the CODE IS RIGHT and the
   INTERACTION IS WRONG, which is why the fix for each is a rule about how
   controls compose, and why those rules are pinned here.

   WHAT THIS DOES NOT PROVE

   That every control works. Only a real click proves that, and the two bugs
   above were both found by clicking. This stops these two from coming back.

   Run:  node tests/dead-controls.test.cjs
   ========================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + detail);
}
function read(p) {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; }
}

console.log('\nDEAD CONTROLS\n');

// ── 1. GL-081: a panel's own toggle is not an "outside" click ──────────────
// The close-on-outside-click handler and the toggle both live on document, so
// the closer has to recognise the control that opened it. Matching on the
// action name rather than an element id means a second control wired to the
// same toggle is covered without editing the handler.
const helpSrc = read('src/shared/help-features.js');
const closer = (() => {
  const i = helpSrc.indexOf("Esc closes the panel");
  return i < 0 ? '' : helpSrc.slice(i, i + 1800);
})();

check('the AI panel outside-click handler exists',
  closer.length > 0 && closer.includes('closePanel()'),
  'GL-081 was in this handler; if it moved, re-point this check rather than deleting it');
check('it exempts the control that opens the panel',
  closer.includes('data-gl-action="glAIHubTogglePanel"'),
  'without the exemption the sidebar AI Tools button opens the panel and this closes it on the same click');
check('the exemption is matched by action, not element id',
  !/nav-ai-tools-btn/.test(closer),
  'an id-based exemption covers exactly one button and silently misses the next one');

// The toggle itself must stay reachable from markup.
const registry = read('src/shared/action-registry.js');
check('glAIHubTogglePanel is still registered',
  registry.includes("'glAIHubTogglePanel'"),
  'unregistered means unreachable from markup no matter what globals exist');

// ── 2. GL-082: `hidden` and an inline display: cannot both decide ──────────
// [hidden] is a UA rule; an inline display beats it. Whichever one the code
// toggles, the other wins, and the control looks dead.
const shipped = (() => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)]
    .map(m => m[1]).filter(s => !/^https?:/.test(s)).map(s => s.replace(/^\//, ''));
  return ['index.html', ...srcs].map(f => ({ file: f, text: read(f) })).filter(x => x.text);
})();

check('the shipped file list was actually built',
  shipped.length > 50,
  'found only ' + shipped.length + ' files — the scan stopped matching, so the check below is vacuous');

const offenders = [];
for (const { file, text } of shipped) {
  for (const tag of text.match(/<[a-z][^>]*>/gi) || []) {
    const styleMatch = tag.match(/style\s*=\s*("|')([^"']*)\1/i);
    if (!styleMatch) continue;
    if (!/display\s*:\s*(flex|block|grid|inline)/i.test(styleMatch[2])) continue;
    // Test for the `hidden` ATTRIBUTE with the style and class VALUES removed —
    // otherwise `overflow:hidden` inside the style reads as the attribute and
    // every rounded card in the CRM is a false positive. That is what the first
    // version of this check did.
    const withoutValues = tag
      .replace(/style\s*=\s*("|')[^"']*\1/gi, '')
      .replace(/class\s*=\s*("|')[^"']*\1/gi, '');
    if (/\shidden(\s|>|\/|=)/i.test(withoutValues)) {
      offenders.push(file + ': ' + tag.replace(/\s+/g, ' ').slice(0, 90));
    }
  }
}
check('no element decides visibility with both hidden and inline display',
  offenders.length === 0,
  offenders.length ? offenders.slice(0, 4).join('\n        ') : '');

// The quote services panel specifically: it must drive display, not `hidden`.
const qb = read('src/modules/quotes/quote-builder.js');
const panelHtml = (() => {
  const i = qb.indexOf('gl-q-svc-panel');
  return i < 0 ? '' : qb.slice(i - 200, i + 500);
})();
check('the quote services panel starts collapsed via display',
  panelHtml.includes("display:none") && !/gl-q-svc-panel[^>]{0,120}hidden/.test(qb),
  'GL-082: it rendered expanded on every row because inline display outranked hidden');
check('its toggle drives the same property it was initialised with',
  /gl-q-svc-panel[\s\S]{0,400}?panel\.style\.display\s*=/.test(qb),
  'toggling `hidden` while display is set inline changes nothing on screen');

// ── 3. GL-085 / GL-086: a form field's id must be unique across the app ────
// document.getElementById returns the FIRST element in document order, and
// every CRM page and panel stays in the DOM. So a second element carrying a
// form field's id silently takes over every read and write of that field.
//
//   GL-085  The deal panel's meeting-notes <div> reused the notes <textarea>'s
//           id. Edit opened with the notes field blank and Save discarded
//           whatever was typed into it.
//   GL-086  The Trace/Recall page's search box reused the Compliance "Trace
//           Lot" input's id. Once that tab had been opened, recall searches
//           ran for "" whatever was typed.
//
// The rule: an id used by an <input>/<textarea>/<select> may be defined in
// only one file. Ids that are only created when absent are allowlisted with
// the reason, so an entry here is a decision rather than a blind spot.
const FIELD_ID_ALLOW = {
  'gl-remember-cb': 'crm-extras.js injects it only when the login form lacks one (`if(pw.querySelector(...)) return`); one per page verified live'
};
const stripJsComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');
const idDefs = {};   // id -> [{file, field}]
for (const { file, text } of shipped) {
  const src = /\.html$/.test(file) ? text.replace(/<!--[\s\S]*?-->/g, '') : stripJsComments(text);
  for (const m of src.matchAll(/<(input|textarea|select|div|span|section|p|button|label)\b[^>]*?\bid\s*=\s*\\?["']([A-Za-z][\w-]*)\\?["']/gi)) {
    (idDefs[m[2]] = idDefs[m[2]] || []).push({ file, field: /^(input|textarea|select)$/i.test(m[1]) });
  }
}
check('the id scan found form fields to check',
  Object.values(idDefs).filter(v => v.some(d => d.field)).length > 50,
  'too few form-field ids found — the scan stopped matching and the check below is vacuous');
const fieldCollisions = Object.entries(idDefs)
  .filter(([id, defs]) => defs.some(d => d.field) && new Set(defs.map(d => d.file)).size > 1 && !FIELD_ID_ALLOW[id])
  .map(([id, defs]) => id + ' in ' + [...new Set(defs.map(d => d.file))].join(', '));
check('no form field shares its id with an element in another file',
  fieldCollisions.length === 0,
  fieldCollisions.slice(0, 6).join('\n        '));
check('the deal notes field is the only ddp-notes',
  (idDefs['ddp-notes'] || []).length === 1 && idDefs['ddp-notes'][0].field,
  'GL-085: a second ddp-notes element makes Edit show blank notes and Save discard typed ones');
check('the recall search box has its own id',
  (idDefs['gl-recall-q'] || []).length === 1 &&
  !(idDefs['gl-trace-q'] || []).some(d => /trace\.js$/.test(d.file)),
  'GL-086: sharing gl-trace-q with Compliance makes recall searches run for an empty string');

// ── 4. GL-091: a handler with no argument receives the click Event ─────────
// actions.js calls fn.apply(el, args.concat([ev])). A button with no
// data-gl-arg1 therefore passes the Event as the handler's FIRST parameter.
// "Log today's GMP" took an optional form code there, treated the Event as a
// code, and opened an empty form reading "Form [object MouseEvent] is not set
// up yet". Any handler reachable without an argument must either name its first
// parameter as an event or explicitly reject a non-value.
const shippedBlob = shipped.map(x => x.text).join('\n');
const noArgActions = new Map();
for (const { file, text } of shipped) {
  for (const m of text.matchAll(/<[a-z]+\b[^>]*data-gl-action=\\?["']([A-Za-z0-9_]+)\\?["'][^>]*>/gi)) {
    if (/data-gl-arg1|data-gl-el/.test(m[0])) continue;
    noArgActions.set(m[1], file);
  }
}
check('the no-argument action scan found controls to check',
  noArgActions.size > 50,
  'found ' + noArgActions.size + ' — the markup pattern changed and the check below is vacuous');
const EVENTISH = /^(e|ev|evt|event|_e|_ev|_)$/;
const unguarded = [];
for (const [name, file] of noArgActions) {
  const re = new RegExp('(?:window\\.' + name + '\\s*=\\s*(?:async\\s+)?function\\s*[A-Za-z0-9_]*|(?:async\\s+)?function\\s+' + name + ')\\s*\\(([^)]*)\\)\\s*\\{');
  const m = re.exec(shippedBlob);
  if (!m) continue;
  const first = (m[1].split(',')[0] || '').trim();
  if (!first || EVENTISH.test(first)) continue;
  const body = shippedBlob.slice(m.index + m[0].length, m.index + m[0].length + 900);
  const guarded = new RegExp('typeof\\s+' + first + "\\s*!==\\s*'(string|object)'").test(body) ||
                  new RegExp(first + '\\s+instanceof\\s+Event').test(body);
  if (!guarded) unguarded.push(name + '(' + first + ') via ' + file);
}
check('handlers reachable without an argument reject the click Event',
  unguarded.length === 0,
  unguarded.join('\n        '));

// ── 5. GL-096 / GL-097: selectors for inline handlers can never match ──────
// The inline-handler budget is 0 (tests/inline-handler-budget.test.cjs): every
// onclick / oninput became data-gl-action. Code that still LOOKS for those
// attributes — querySelector('[onclick*="…"]') — silently matches nothing:
//   invoice add-ons dropped from the saved amount, the displayed total and edits
//   (input[oninput*="addons"]); the client panel's Notes, Templates and Statement
//   buttons never injected ([onclick*="aiScoreClientHealth"],
//   button[onclick*="glOpenEditClient"]).
const staleSelectors = [];
for (const { file, text } of shipped) {
  const code = /\.html$/.test(file) ? text.replace(/<!--[\s\S]*?-->/g, '') : text.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  code.split('\n').forEach((line, i) => {
    const stripped = line.replace(/\/\/.*$/, '');
    if (/\[on(click|input|change|submit|keyup|keydown|blur|focus)\*?=/.test(stripped)) staleSelectors.push(file + ':' + (i + 1) + '  ' + stripped.trim().slice(0, 80));
  });
}
check('no code selects elements by an inline event-handler attribute',
  staleSelectors.length === 0,
  staleSelectors.slice(0, 6).join('\n        '));

// ── 6. GL-097: an injector must be woken by the element it injects into ────
// The client detail overlay is appended to document.body, but the accounting
// observer only watched #crm-panel, so the Statement button never appeared on
// open. Found live after the selector fix above had shipped.
const acct = read('src/modules/invoicing/accounting.js');
check('the accounting injectors also observe document.body children',
  /_acctObs\.observe\(document\.body, \{ childList: true \}\)/.test(acct) &&
  /ov\.id = 'client-detail-overlay';[\s\S]{0,6000}?document\.body\.appendChild\(ov\)/.test(read('crm-index-core.js')),
  'if the client overlay is appended to body, a #crm-panel-only observer never sees it open');

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
