#!/usr/bin/env node
/* ============================================================================
   PUBLISHED SURFACE — what the public web is allowed to serve (GL-079)
   ----------------------------------------------------------------------------
   WHY THIS EXISTS

   Vercel serves this repository from its ROOT. Every committed file is
   therefore a URL, and until 2026-09-16 that included all of this, live and
   returning 200:

     /docs/database/authorization-baseline.txt  113 KB — every RLS policy
                                                expression, every table grant,
                                                and every SECURITY DEFINER
                                                function with its exact
                                                signature and ACL
     /docs/plans/technical-debt.md               69 KB — the defect register,
                                                including issues still OPEN
     /CLAUDE.md /SECURITY.md /CRM_FEATURE_MAP.md
     /scripts/security-invariants.sh            the probe that guards the site
     /supabase/migrations/ (every .sql)         the whole schema history
     /supabase/functions/ (every .ts)           edge function source
     /tests/ (every .test.cjs)

   No credentials were exposed -- .gitignore keeps secrets.env and every .env
   out of the repo, so they were never uploaded, and a scan of all 95 shipped
   scripts found no key material. RLS is the actual enforcement and RLS holds:
   an anonymous visitor was refused on 29 of 30 tables and on every portal RPC.

   So this guards against reconnaissance, not a breach. The distinction matters,
   because the temptation is to call it cosmetic and skip the guard. It is not
   cosmetic to hand an attacker the function inventory to probe, the migration
   history to diff, and a register naming the weaknesses we know about and have
   not fixed yet.

   WHAT IT DOES NOT PROVE

   That production stopped serving them. This reads .vercelignore; only a
   request to the deployed site proves the deployment changed. Re-probe after
   the first deploy that follows this commit:

     curl -o /dev/null -w '%{http_code}\n' https://www.goodliquidbevco.com/CLAUDE.md

   THE FAILURE MODE THIS IS REALLY FOR

   Not someone deleting .vercelignore -- that is obvious. It is a page one day
   referencing a file inside an excluded directory, the asset 404ing in
   production only, and the fix being to widen the exclusion rather than move
   the file. The second half of this test exists for that: it re-derives what
   the HTML entry points reference and fails if any of it is excluded, so the
   two rules cannot drift apart silently.

   Run:  node tests/published-surface.test.cjs
   ========================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE = path.join(ROOT, '.vercelignore');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + detail);
}

console.log('\nPUBLISHED SURFACE\n');

// ── The file must exist at all ─────────────────────────────────────────────
const exists = fs.existsSync(IGNORE);
check('.vercelignore exists',
  exists,
  'without it Vercel uploads the entire repository and every file is a public URL');

if (!exists) {
  console.log('\n1 FAILED\n');
  process.exit(1);
}

const patterns = fs.readFileSync(IGNORE, 'utf8')
  .split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

check('it contains rules, not only commentary',
  patterns.length > 0,
  'a file of pure explanation excludes nothing');

// Mirrors .gitignore semantics closely enough for the shapes used here:
// a trailing-slash directory prefix, a *.ext suffix, or an exact path.
function isExcluded(p) {
  return patterns.some(pat => {
    if (pat.endsWith('/')) return p === pat.slice(0, -1) || p.startsWith(pat);
    if (pat.startsWith('*.')) return p.endsWith(pat.slice(1));
    return p === pat;
  });
}

// ── 1. The directories that must never be published ────────────────────────
// Each names a real file that was live at that path on 2026-09-16.
const mustExclude = [
  ['docs/database/authorization-baseline.txt', 'the complete authorization model'],
  ['docs/plans/technical-debt.md',             'known defects, including open ones'],
  ['scripts/security-invariants.sh',           'the probe that guards production'],
  ['scripts/db-drift-snapshot.sql',            'exactly what the drift check reads'],
  ['tests/portal-tenant-isolation.test.cjs',   'the tenant rules, as assertions'],
  ['supabase/migrations/20260807020000_tenant_isolation_guard.sql', 'schema history'],
  ['supabase/functions/_shared/auth.ts',       'edge function authorization source'],
  ['supabase/config.toml',                     'project configuration'],
  ['prompts/client-portal-v2.md',              'internal product decisions'],
  ['CLAUDE.md',                                'architecture and incident history'],
  ['SECURITY.md',                              'the security model, written out'],
  ['CRM_FEATURE_MAP.md',                       'the full feature and gate inventory'],
  ['AGENTS.md',                                'index of the internal documentation'],
  ['.github/workflows/db-drift.yml',           'CI configuration'],
];

for (const [file, why] of mustExclude) {
  check('not published: ' + file,
    isExcluded(file),
    why + ' — this path returned 200 on the public site before GL-079');
}

// ── 2. ...without breaking the site ────────────────────────────────────────
// Re-derived from the HTML rather than hardcoded, so it keeps testing the
// real answer as pages change.
const PAGES = ['index.html', 'onboard.html', 'book.html',
               'approve.html', 'auditor.html', 'reset.html'];

const referenced = new Set();
for (const page of PAGES) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|\/\/|#|mailto:|tel:|data:|\?)/.test(u)) continue;
    const clean = u.replace(/^\//, '').split(/[?#]/)[0];
    if (clean) referenced.add(clean);
  }
}

check('the entry points were actually read',
  referenced.size > 50,
  'found only ' + referenced.size + ' referenced assets — the scan stopped matching, so the check below is vacuous');

const broken = [...referenced].filter(isExcluded);
check('nothing the site loads is excluded',
  broken.length === 0,
  broken.length
    ? 'these would 404 in production but work locally: ' + broken.slice(0, 8).join(', ')
    : '');

// ── 3. The root-level runtime must stay publishable ────────────────────────
// supabase.min.js is self-hosted at the ROOT (see .gitignore) and is NOT part
// of the supabase/ directory. A rule written as "supabase" rather than
// "supabase/" would take the client library out with the migrations and break
// every page on the site.
check('the self-hosted Supabase client is still publishable',
  !isExcluded('supabase.min.js'),
  'the exclusion must be "supabase/" (the directory), never bare "supabase"');

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
