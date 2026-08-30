/*
 * inline-handler-budget.test.cjs — the ratchet for GL-DEF-01.
 *
 * The CSP keeps script-src 'unsafe-inline' because inline on* handlers resolve
 * against window. Removing that allowance means removing the handlers, over
 * several phases. This is what measures the progress and stops it sliding back.
 *
 * HOW IT WORKS
 * ------------
 * Every file gets a BUDGET: the number of inline handlers it is currently
 * allowed. A file over budget fails. A file UNDER budget also fails, asking
 * for the budget to be lowered — otherwise a phase lands, the count drops, and
 * the slack silently becomes room for new handlers to be added again.
 *
 * That is the GL-039 pattern: absence is opt-in and visible, never the default.
 *
 * COUNTING RULES
 * --------------
 * Comments are stripped first. actions.js quotes `" onmouseover="alert(1)` in
 * its header while explaining what it defends against, and a naive count reads
 * that as a real handler. Three separate tests in this repo have now been
 * broken by a comment containing the thing they were looking for, so this one
 * strips before it counts.
 *
 * Run:  node tests/inline-handler-budget.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// Comments out, then count. An HTML file has no // or /* */ at the top level
// worth stripping, but a JS file that documents XSS payloads certainly does.
function strip(src, isJs) {
  if (!isJs) return src;
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HANDLER = /\bon(click|change|input|submit|keyup|keydown|keypress|blur|focus|mouseover|mouseout|mouseenter|mouseleave|load|error|dblclick)\s*=\s*["']/gi;

function countIn(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return 0;
  const isJs = rel.endsWith('.js');
  return (strip(fs.readFileSync(abs, 'utf8'), isJs).match(HANDLER) || []).length;
}

/*
 * BUDGETS — lower these as each phase lands; never raise one.
 *
 * Measured 2026-08-29, at the end of phase 1 (the dispatcher exists, nothing
 * is converted yet). Only files that currently HAVE handlers are listed; a
 * file not listed here is budgeted at zero, so a new handler anywhere fails.
 */
const BUDGET = {
  'crm-index-core.js': 0,
  'index.html': 0,
  'src/services/permissions-service.js': 0,
  'src/modules/invoicing/invoice-builder.js': 0,
  'src/shared/tools.js': 0,
  'src/modules/customers/portal-customer.js': 0,
  'src/modules/pipeline/referrals.js': 0,
  'src/modules/customers/edit-client.js': 0,
  'src/modules/invoicing/invoice-patches.js': 0,
  'src/shared/ai-hub.js': 0,
  'src/modules/customers/artwork.js': 0,
  'src/modules/customers/client-detail.js': 0,
  'src/modules/customers/tags.js': 0,
  'src/modules/pipeline/deal-docs.js': 0,
  'src/modules/production/gmp.js': 0,
  'src/modules/production/production-runs.js': 0,
  'src/modules/production/trace.js': 0,
  'src/shared/admin-tools.js': 0,
  'src/modules/invoicing/ar-aging.js': 0,
  'src/modules/invoicing/pay-link.js': 0,
  'src/modules/pipeline/attention.js': 0,
  'src/modules/pipeline/meeting-notes.js': 0,
  'src/modules/pipeline/scheduling.js': 0,
  'src/modules/production/compliance.js': 0,
  'src/modules/production/gmp-schedule.js': 0,
  'src/modules/production/tour-booking.js': 0,
  'src/shared/calendar.js': 0,
  'src/shared/public-ops.js': 0,
};

console.log('inline handler budget — the ratchet for removing unsafe-inline\n');

const tracked = ['index.html', 'crm-index-core.js'].concat(
  walk(path.join(ROOT, 'src'), []).map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
);

let total = 0;
const over = [];
const under = [];

for (const rel of tracked) {
  const n = countIn(rel);
  total += n;
  const budget = BUDGET[rel] || 0;
  if (n > budget) over.push(rel + ': ' + n + ' > budget ' + budget);
  else if (n < budget) under.push(rel + ': ' + n + ' < budget ' + budget);
}

check('no file exceeds its inline-handler budget',
  over.length === 0,
  over.join('\n          ') +
  '\n          A new inline handler cannot be added while GL-DEF-01 is in ' +
  'progress. Register it with glRegisterAction and use data-gl-action instead.');

check('no budget is stale (a file below budget must have it lowered)',
  under.length === 0,
  under.join('\n          ') +
  '\n          Lower the budget in this file to match. Leaving slack turns a ' +
  'completed conversion into room for new handlers.');

console.log('');
console.log('  total inline handlers: ' + total);
console.log('  budgeted total:        ' + Object.values(BUDGET).reduce((a, b) => a + b, 0));

// The dispatcher must exist and be loaded before any conversion can rely on it.
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('the action dispatcher exists',
  fs.existsSync(path.join(ROOT, 'src/shared/actions.js')));
check('index.html loads the dispatcher',
  /src="\/src\/shared\/actions\.js"/.test(indexHtml));

// Every data-gl-action in the codebase must name something registered, or the
// control is dead. Cheap to check now, essential once conversions start.
// Comments stripped here too. actions.js documents the attribute shape with a
// worked example — <button data-gl-action="deleteDoc" …> — and an unstripped
// scan reads that as a real, unregistered, dead control.
const allSrc = tracked.map((f) => {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? strip(fs.readFileSync(p, 'utf8'), f.endsWith('.js')) : '';
}).join('\n');
// Scanned from the RAW sources, NOT the comment-stripped copy, and that
// direction is deliberate.
//
// The stripper treats any /* as a block comment. src/modules/customers/
// portal-customer.js line 591 carries a file input with
// accept="/*,.pdf,.doc,..." — the /* in that attribute value opened a comment
// that ran 519 lines, so a THIRD of the customer portal was invisible here.
// Hiding in that region was data-gl-action="glPortalUploadAgreement", used but
// registered nowhere: a dead Upload button on the portal, which this check
// exists precisely to catch, passing green.
//
// A dead-control guard must fail loudly rather than miss silently, so the scan
// now reads raw text and the one genuine documentation example is named
// explicitly below. A new doc example costs one line here; a dead button costs
// a customer a working page.
const DOCUMENTED_EXAMPLES = new Set([
  // src/shared/actions.js explains the attribute shape with a worked example:
  //   <button data-gl-action="deleteDoc" data-gl-arg1="${esc(d.id)}">
  'deleteDoc',
]);
const rawAll = tracked.map((f) => {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}).join('\n');
const used = [...rawAll.matchAll(/data-gl-action="([A-Za-z_$][\w$]*)"/g)]
  .map((m) => m[1])
  .filter((n) => !DOCUMENTED_EXAMPLES.has(n));
// Three registration forms, all of which must count:
//   glRegisterAction('name', fn)
//   glRegisterActions({ name: fn, ... })
//   glRegisterGlobalActions(['name', ...])   <- the generated registry
// Missing the third made every one of the 82 generated names read as
// unregistered, i.e. as 82 dead controls, when they were all fine.
const registered = [...rawAll.matchAll(/glRegisterAction\(\s*'([^']+)'/g)].map((m) => m[1])
  .concat([...rawAll.matchAll(/glRegisterActions\(\s*\{([^}]*)\}/g)]
    .flatMap((m) => [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1])))
  .concat([...rawAll.matchAll(/glRegisterGlobalActions\(\s*\[([\s\S]*?)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])));
const unknown = [...new Set(used)].filter((u) => !registered.includes(u));
check('every data-gl-action names a registered action',
  unknown.length === 0,
  unknown.join(', ') + ' — these controls are dead: the dispatcher logs an ' +
  'error and does nothing, which looks exactly like a working button');

// ── data-gl-action written into ANOTHER document ──────────────────────
// The dispatcher listens on THIS document. Markup rendered into a popup
// (window.open + document.write) has no listener at all, so a data-gl-action
// button there is dead — and it fails silently, because the dispatcher that
// would report an unregistered action is not present either.
//
// This is not hypothetical. GL-DEF-01 phase 5 converted the Print and Close
// buttons in five compliance report popups from onclick="window.print()" to
// data-gl-action, and they stopped working. Restoring the inline handlers is
// not possible either: a window.open('') document inherits the opener's CSP,
// which no longer allows inline script. They are bound from the opener instead,
// via glBindPopupControls.
//
// So: a file that writes into a foreign document AND emits data-gl-action must
// also bind those controls.
// Scoped to the popup's CONSTRUCTION REGION — between window.open() and the
// matching document.write() — not the whole file. A first version asked only
// whether the file contained both, and reported three false positives:
// invoice-builder, quote-builder and tools all write popups AND use
// data-gl-action, but in main-document markup, twice at a line AFTER the write.
// A guard that cries wolf gets switched off, so it has to look where the markup
// actually goes.
const unbound = [];
for (const f of tracked) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    if (!/\.document\.write\(/.test(line)) return;
    // Walk back to where this popup began; cap the span so an unrelated
    // window.open far above cannot pull in the whole file.
    let start = i;
    for (let j = i; j >= 0 && i - j < 120; j--) {
      if (/window\.open\(/.test(lines[j])) { start = j; break; }
      start = j;
    }
    const region = lines.slice(start, i + 1).join('\n');
    if (!/data-gl-action="/.test(region)) return;          // nothing delegated in this popup
    if (/glBindPopupControls/.test(src)) return;           // already bound in this file
    unbound.push(f + ':' + (i + 1));
  });
}

check('every file writing data-gl-action into a popup binds those controls',
  unbound.length === 0,
  unbound.join(', ') +
  '\n          The dispatcher listens on the main document only. Call ' +
  'window.glBindPopupControls(w) after w.document.close(), or those buttons ' +
  'are dead and nothing will say so.');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
