#!/usr/bin/env node
/* ============================================================================
   UNCHECKED WRITES — every .update() / .delete() must look at what happened
   ----------------------------------------------------------------------------
   WHY THIS EXISTS (GL-094)

   CLAUDE.md rule 4: RLS rejects silently — 0 rows, no error — so a write whose
   result is never inspected reports success while nothing saved. The existing
   checked-mutations test enforces that for the paths it names. It did not see
   these, found on 2026-09-16 by clicking through the CRM with every database
   write intercepted:

     moveDeal          The card moved to its new pipeline column, no message —
                       and on a move to Closed Won, the deal-won notification and
                       the SMS wrapper fired anyway, for a deal that did not close.
     setDealOutreach   The new outreach status stayed on the card and "Email
                       logged" went into the activity feed.
     saveNewClient     A W-9 / tax-exempt / PA letter uploaded to storage while
                       the client record went on saying nothing was on file.

   This test is the generic version: it walks every shipped script, finds each
   `.from(table).update(` / `.delete(` statement, and fails on any whose chain
   never reaches `.select(` — unless that exact statement is allowlisted below
   with a reason. An allowlist entry is a decision, not a blind spot, and a
   stale entry fails too.

   Run:  node tests/unchecked-writes.test.cjs
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

// file, table, op, a substring unique to the statement, and why it is allowed.
const ALLOW = [
  ['crm-index-core.js', 'invoices', 'update', "const base = window.supa.from('invoices').update(patch)",
    'the query is built here and .select() is appended on the next statement, then both error and 0 rows are checked'],
  ['src/shared/users-page.js', 'profiles', 'update', "supa.from('profiles').update(...)`",
    'inside a comment describing a removed code path'],
  ['src/shared/public-ops.js', 'deals', 'update', "supa.from('deals').update(...). Stripped",
    'inside a comment'],
  ['src/modules/production/compliance-ext.js', 'inspector_tokens', 'update', "update({ last_used_at",
    'best-effort usage counter on an auditor token; a failure changes nothing a person sees or relies on'],
  ['src/modules/pipeline/deal-brief.js', 'ai_briefs', 'update', "update({ stale:false, ball:",
    'AI brief cache bookkeeping; the brief is regenerated on demand if the flag did not stick'],
  ['src/modules/pipeline/deal-brief.js', 'ai_briefs', 'update', "update({ stale:false, updated_at:",
    'AI brief cache bookkeeping'],
  ['src/modules/pipeline/deal-brief.js', 'ai_briefs', 'update', "update({ stale:true })",
    'marks a cached brief stale before a forced refresh; the refresh overwrites it regardless'],
  ['src/modules/pipeline/deal-brief.js', 'ai_brief_todos', 'update', "update({ done:true, done_at:",
    'the AI closing its own suggested to-dos in the background; the next brief run re-evaluates them']
];

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const files = [...new Set(['crm-index-core.js', ...[...html.matchAll(/<script src="([^"]+)"/g)]
  .map(m => m[1]).filter(s => !/^https?:/.test(s)).map(s => s.replace(/^\//, ''))
  .filter(f => f !== 'supabase.min.js' && fs.existsSync(path.join(ROOT, f)))])];

check('the shipped script list was actually built', files.length > 50,
  'found ' + files.length + ' files — the scan is vacuous');

const found = [];
for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /\.from\(\s*['"]([a-z_]+)['"]\s*\)\s*\.(update|delete)\(/g;
  let m;
  while ((m = re.exec(t))) {
    let i = re.lastIndex, depth = 1;
    for (; i < t.length; i++) {
      const ch = t[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0 && (ch === ';' || ch === ',' || ch === '}')) break;
      else if (depth === 0 && ch === '\n') {
        const rest = t.slice(i + 1).match(/^\s*(\S)/);
        if (!rest || rest[1] !== '.') break;
      }
    }
    const stmt = t.slice(m.index, i);
    if (/\.select\(/.test(stmt)) continue;
    const lineStart = t.lastIndexOf('\n', m.index) + 1;
    const lineEnd = t.indexOf('\n', m.index);
    const line = t.slice(lineStart, lineEnd < 0 ? t.length : lineEnd);
    // Match allowlist snippets against the source line AND the whole statement,
    // whitespace-collapsed: a statement's fields often continue on the next line.
    found.push({ file: f, table: m[1], op: m[2], line: t.slice(0, m.index).split('\n').length, text: line + ' ' + stmt });
  }
}

check('the scan found update/delete statements at all',
  files.some(f => /\.from\(\s*['"][a-z_]+['"]\s*\)\s*\.(update|delete)\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))),
  'no writes found — the pattern changed and this test is vacuous');

const used = new Set();
const unexplained = found.filter(h => {
  const a = ALLOW.findIndex(([file, table, op, snip]) =>
    file === h.file && table === h.table && op === h.op && h.text.replace(/\s+/g, ' ').includes(snip.replace(/\s+/g, ' ')));
  if (a > -1) { used.add(a); return false; }
  return true;
});
check('every update/delete checks its result, or is allowlisted with a reason',
  unexplained.length === 0,
  unexplained.map(h => h.file + ':' + h.line + '  ' + h.op + ' ' + h.table + '  —  add .select() and check error AND 0 rows').join('\n        '));

const stale = ALLOW.filter((_, i) => !used.has(i));
check('no stale allowlist entries',
  stale.length === 0,
  stale.map(a => a[0] + ' ' + a[2] + ' ' + a[1] + ' — no longer matches; remove it').join('\n        '));

// The three fixed paths, specifically.
const core = fs.readFileSync(path.join(ROOT, 'crm-index-core.js'), 'utf8');
check('moveDeal returns false and sends nothing when the move is rejected',
  /async function moveDeal[\s\S]{0,2500}?\.update\(\{stage:toStage[\s\S]{0,120}?\.select\(/.test(core) &&
  /async function moveDeal[\s\S]{0,3000}?Nothing was sent\.'\);\s*return false;/.test(core),
  'a rejected move to Closed Won used to send the deal-won alerts anyway');
const integ = fs.readFileSync(path.join(ROOT, 'src/services/integrations.js'), 'utf8');
check('the Closed Won SMS wrapper respects a rejected move',
  /if\(r !== false && toStage === 'Closed Won'\)/.test(integ),
  'without it the SMS goes out even when moveDeal reports failure');

// ── GL-095: inserts and upserts whose result was thrown away ───────────────
// An RLS-rejected insert does return an error, so the failure mode for inserts
// is ignoring the result entirely. These four reported success regardless.
const comp = fs.readFileSync(path.join(ROOT, 'src/modules/production/compliance.js'), 'utf8');
check('glass breakage does not announce a hold tag that was not created',
  /var holdIns = await window\.supa\.from\('hold_tags'\)\.insert\([\s\S]{0,900}?\.select\('id'\);[\s\S]{0,300}?if\(!holdIns \|\| holdIns\.error/.test(comp) &&
  comp.includes('HOLD TAG WAS NOT CREATED'),
  'a physical-hazard hold announced as created while the insert had failed');
check('the CSV training import counts only rows the database accepted',
  /var ins = await window\.supa\.from\('compliance_records'\)\.insert\([\s\S]{0,700}?\.select\('id'\);[\s\S]{0,400}?if\(ins && !ins\.error[\s\S]{0,80}?\)\{ done\+\+; \}/.test(comp),
  '"Imported N training records" could report rows the database rejected');
check('a weekly-review sign-off is cached only after the database recorded it',
  /var aq = await window\.supa\.from\('compliance_acks'\)\.upsert\([\s\S]{0,200}?\.select\('record_id'\);[\s\S]{0,300}?_weeklyAckCache\[recordId\] = new Date/.test(comp),
  'a rejected sign-off showed as signed off');
const onb = fs.readFileSync(path.join(ROOT, 'src/modules/customers/onboarding.js'), 'utf8');
check('label artwork carried over at conversion reports a failed copy',
  /var art = await sb\(\)\.from\('client_artwork'\)\.insert\([\s\S]{0,700}?\.select\('id'\);[\s\S]{0,200}?carryOverProblems\.push\('label artwork was NOT copied/.test(onb),
  'every label was lost silently when the insert was rejected');
check('the dormant saveClient re-insert wrapper stays removed',
  !/window\.saveClient\s*=\s*async function/.test(core),
  'it would have created every client twice the day a saveClient existed');

// ── GL-096: the invoice builder save ───────────────────────────────────────
const invp = fs.readFileSync(path.join(ROOT, 'src/modules/invoicing/invoice-patches.js'), 'utf8');
check('invoice add-ons are read through their data-gl-action inputs',
  invp.includes(`document.querySelectorAll('#gl-inv-body [data-gl-action="glSetAddonDesc"]')`) &&
  invp.includes(`document.querySelectorAll('#gl-inv-body [data-gl-action="glSetAddonPrice"]')`),
  'add-ons were left out of every saved invoice amount');
check('invoice notes are saved, not hard-coded empty',
  /notes:notes,/.test(invp) && /notes: notes \|\| null/.test(invp) && !/payload\.notes = '';/.test(invp),
  'payment instructions typed in the builder never reached the invoice');
check('"Invoice saved" is announced only after the database returns the row',
  (() => { const saving = invp.indexOf("addNotification('Saving invoice '"); const insert = invp.indexOf("sb.from('invoices').insert(working)"); const saved = invp.indexOf("addNotification('Invoice saved: '"); return saving > -1 && insert > -1 && saved > insert && saving < insert; })(),
  'the success toast fired before the insert was even attempted');
check('a rejected invoice is removed from the list and the builder reopens',
  /function invoiceSyncFailed\(reason\)\{[\s\S]{0,700}?b\.classList\.add\('show'\)/.test(invp) &&
  (invp.match(/invoiceSyncFailed\('/g) || []).length >= 4,
  'a rejected invoice stayed in the list as if saved, and what was typed was lost');
const crmx = fs.readFileSync(path.join(ROOT, 'src/shared/crm-extras.js'), 'utf8');
check('invoice_save is not audited before the save is confirmed',
  !/window\.glSaveInvoice = function\(\)\{[\s\S]{0,200}?glAudit\('invoice_save'/.test(crmx),
  'the wrapper logged invoice_save the moment the optimistic save returned');
check('invoice notes are escaped in the printable invoice',
  /\$\{esc\(inv\.notes\)\}<\/td><\/tr>`:''\}/.test(core),
  'notes become real content with GL-096; the PDF template inserted them raw');

// ── GL-098: three more discarded results, each followed by a success signal ──
check('the CIP equipment editor does not close as saved after a rejected upsert',
  /var uq = await sb\.from\('cip_equipment'\)\.upsert\([\s\S]{0,200}?\.select\('id'\);[\s\S]{0,200}?failedNames\.push/.test(comp) &&
  /if\(failedNames\.length\)\{[\s\S]{0,300}?return;/.test(comp),
  'the list was cached locally and the editor closed even when the server refused it');
check('the annual FSP reminder is announced only when its task row exists',
  /var taskIns = await window\.supa\.from\('compliance_tasks'\)\.insert\([\s\S]{0,500}?\.select\('id'\);[\s\S]{0,400}?NOT scheduled[\s\S]{0,200}?return;/.test(comp),
  '"Annual FSP review scheduled" fired whether or not the task was created');
const tools = fs.readFileSync(path.join(ROOT, 'src/shared/tools.js'), 'utf8');
check('an NPS response is acknowledged only after the insert succeeds',
  /var npsIns = await window\.supa\.from\('nps_responses'\)\.insert\(\[[^\]]*\]\);/.test(tools) &&
  /if\(!npsSaved\)\{[\s\S]{0,300}?return;\s*\}/.test(tools),
  'a customer was thanked for feedback that was never recorded');
check('the NPS insert does not ask for the row back (anon cannot read nps_responses)',
  !/from\('nps_responses'\)\.insert\([^;]*\.select\(/.test(tools),
  '.select() on an anonymous insert without a read policy fails every submission');

// ── GL-099: invoice amounts in cents ───────────────────────────────────────
// A float amount (6491.999999999999) made a full payment an "overpayment" to
// the ledger and a cent-short one never settle. Rounded in the builder and, for
// every other writer, by a BEFORE trigger that must sort before the paid guard.
check('the invoice builder rounds the saved amount to cents',
  /function cents\(n\)\{ return Math\.round\(\(Number\(n\) \|\| 0\) \* 100\) \/ 100; \}/.test(invp) &&
  /var amount=cents\(subtotal-discountAmt\);/.test(invp),
  'floating-point totals reached invoices.amount');
const centsMig = (() => { try { return fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260916120000_invoice_amount_cents.sql'), 'utf8'); } catch (e) { return ''; } })();
check('the database rounds invoices.amount for every writer, before the paid-state guard',
  /new\.amount := pg_catalog\.round\(new\.amount, 2\)/.test(centsMig) &&
  /create trigger invoices_amount_to_cents\s+before insert or update of amount on public\.invoices/.test(centsMig) &&
  'invoices_amount_to_cents' < 'invoices_guard_paid_state',
  'triggers fire in name order; the guard must see the rounded amount');

// ── GL-100: a new invoice must never inherit a previous edit's target ───────
const invb = fs.readFileSync(path.join(ROOT, 'src/modules/invoicing/invoice-builder.js'), 'utf8');
check('opening the reused invoice builder clears the edit markers and title',
  /window\.openNewInvoiceBuilder = function\(preClientId\)\{[\s\S]{0,1800}?\} else \{[\s\S]{0,900}?existing\.removeAttribute\('data-editing-id'\);\s*existing\.removeAttribute\('data-editing-supa-id'\);[\s\S]{0,300}?'NEW INVOICE'/.test(invb),
  'Edit invoice → close → + New Invoice saved the new invoice OVER the edited one');

// ── GL-116: staff invites ──────────────────────────────────────────────────
const inviteFn = fs.readFileSync(path.join(ROOT, 'supabase/functions/invite-staff-user/index.ts'), 'utf8');
check('staff invite accepts the warehouse role and refuses unknown roles instead of swapping to sales',
  /const allowedRoles = \['admin', 'sales', 'viewer', 'warehouse'\];/.test(inviteFn) &&
  !/allowedRoles\.includes\(role\) \? role : 'sales'/.test(inviteFn),
  'inviting a Warehouse user silently created a Sales user');
check('staff invite saves the profile WITH email, checks it, and rolls back on failure',
  /\.upsert\(\{ id: userId, email, name, role: safeRole, status: 'active'/.test(inviteFn) &&
  /\.select\('id, role'\);/.test(inviteFn) &&
  /auth\.admin\.deleteUser\(userId\)/.test(inviteFn) &&
  !/if \(upsertErr\) console\.warn/.test(inviteFn),
  'the profile upsert omitted the required email, failed on every invite, and still returned ok');
const permSvc = fs.readFileSync(path.join(ROOT, 'src/services/permissions-service.js'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''); // comment lines may name the old call
check('the Send Invite button runs createInvitedUser once, not twice',
  !/createBtn\.addEventListener\('click'[\s\S]{0,700}?window\.createInvitedUser\(\)/.test(permSvc),
  'the preset hook re-invoked createInvitedUser on top of the data-gl-action dispatcher');

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
