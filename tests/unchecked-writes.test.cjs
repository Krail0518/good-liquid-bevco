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

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
