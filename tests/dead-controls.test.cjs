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

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
