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
  'index.html': 234,
  'crm-index-core.js': 65,
  'src/modules/invoicing/invoice-builder.js': 20,
  'src/modules/invoicing/invoice-patches.js': 20,
  'src/modules/pipeline/referrals.js': 16,
  'src/services/permissions-service.js': 16,
  'src/shared/admin-tools.js': 11,
  'src/modules/customers/portal-customer.js': 10,
  'src/shared/tools.js': 8,
  'src/modules/production/compliance.js': 7,
  'src/modules/pipeline/scheduling.js': 6,
  'src/modules/production/trace.js': 5,
  'src/shared/calendar.js': 5,
  'src/modules/customers/requests.js': 4,
  'src/modules/customers/tags.js': 4,
  'src/modules/production/production-runs.js': 4,
  'src/shared/ai-hub.js': 4,
  'src/shared/public-ops.js': 4,
  'src/modules/customers/edit-client.js': 3,
  'src/modules/customers/email-templates.js': 3,
  'src/modules/production/gmp.js': 3,
  'src/modules/production/time-tracking.js': 3,
  'src/modules/production/tour-booking.js': 3,
  'src/shared/correspondence.js': 3,
  'src/shared/users-page.js': 3,
  'src/modules/customers/artwork.js': 2,
  'src/modules/customers/client-detail.js': 2,
  'src/modules/customers/client-notes.js': 2,
  'src/modules/customers/onboarding.js': 2,
  'src/modules/invoicing/accounting.js': 2,
  'src/modules/pipeline/deal-docs.js': 2,
  'src/modules/production/audit-review.js': 2,
  'src/modules/production/cip-audit.js': 2,
  'src/modules/production/compliance-ext.js': 2,
  'src/modules/production/gmp-schedule.js': 2,
  'src/modules/production/quality.js': 2,
  'src/shared/tasks.js': 2,
  'src/modules/customers/document-storage.js': 1,
  'src/modules/invoicing/ar-aging.js': 1,
  'src/modules/invoicing/pay-link.js': 1,
  'src/modules/pipeline/attention.js': 1,
  'src/modules/pipeline/meeting-notes.js': 1,
  'src/modules/pipeline/multi-pipeline.js': 1,
  'src/modules/production/training.js': 1,
  'src/modules/quotes/quote-builder.js': 1,
  'src/shared/notifications.js': 1,
  'src/shared/pwa-install.js': 1,
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
const used = [...allSrc.matchAll(/data-gl-action="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
const registered = [...allSrc.matchAll(/glRegisterAction\(\s*'([^']+)'/g)].map((m) => m[1])
  .concat([...allSrc.matchAll(/glRegisterActions\(\s*\{([^}]*)\}/g)]
    .flatMap((m) => [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1])));
const unknown = [...new Set(used)].filter((u) => !registered.includes(u));
check('every data-gl-action names a registered action',
  unknown.length === 0,
  unknown.join(', ') + ' — these controls are dead: the dispatcher logs an ' +
  'error and does nothing, which looks exactly like a working button');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
