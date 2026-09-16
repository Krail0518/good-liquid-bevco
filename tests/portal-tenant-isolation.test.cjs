#!/usr/bin/env node
/* ============================================================================
   PORTAL TENANT ISOLATION — static half
   ----------------------------------------------------------------------------
   WHY THIS EXISTS

   The customer portal is the second class of user in a database whose policies
   were written when there was only one. The 2026-05-18 incident in CLAUDE.md is
   exactly that shape, and the portal-v2 work re-ran the same mistake twice
   during design before it was caught:

     * v1 hid project_milestones.internal_note by omitting it from the portal's
       SELECT. RLS is ROW-level. ?select=internal_note ignores what the UI asked
       for.
     * v2 replaced that with security_invoker views that omitted `actor` and
       `decided_by`. security_invoker means the CALLER's RLS applies, so the
       customer still needs SELECT on the base table — and can still name the
       column.

   The only columns a customer cannot read are the ones on a table they hold no
   policy on. This test pins that conclusion in place so a later change cannot
   quietly reintroduce either shape.

   WHAT IT DOES NOT PROVE

   That the database behaves. It reads migration text and source, nothing more.
   The live half is scripts/rls-identity-invariants.sql, which exercises five
   identities against production. Both halves are required; neither substitutes
   for the other (see tests/payment-ledger.test.cjs).

   Run:  node tests/portal-tenant-isolation.test.cjs
   ========================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');

// Comments are stripped before scanning for forbidden CODE. This file's own
// migrations and modules explain, in prose, exactly what they are forbidden
// from doing -- "this used to be a .from('formulas') select" -- and a raw scan
// scores those explanations as violations. The shared walker is used rather
// than a local regex because three scanners previously desynced on a regex
// literal (see tests/_jsscan.cjs).
const { blankComments } = require('./_jsscan.cjs');
const stripSqlComments = s => s.replace(/--[^\n]*/g, '');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : ''));
}

// ── Sources ────────────────────────────────────────────────────────────────
// Every portal-v2 migration, phase 1 (2026-09-14) and phase 2 (2026-09-15).
// Widen this deliberately when a later phase adds a date — a prefix that stops
// matching turns every check below into a vacuous pass, which is what the
// "migrations to check at all" guard underneath is for.
const PORTAL_MIGRATIONS = fs.readdirSync(MIG_DIR)
  .filter(f => /^2026091[45]\d{6}_/.test(f))
  .sort();
const migSql = PORTAL_MIGRATIONS
  .map(f => fs.readFileSync(path.join(MIG_DIR, f), 'utf8'))
  .join('\n');

function readIfExists(p) {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; }
}

// Every runtime JS file: src/** plus the root crm-*.js. Migrations are history
// and are deliberately excluded — they may name dropped columns.
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const runtimeFiles = walk(path.join(ROOT, 'src'), [])
  .concat(fs.readdirSync(ROOT).filter(f => /^crm-.*\.js$/.test(f)).map(f => path.join(ROOT, f)));
const runtimeSrc = runtimeFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const portalSrcRaw = readIfExists('src/modules/customers/portal-customer.js') +
                     readIfExists('src/modules/customers/portal-project.js');
const portalSrc = blankComments(portalSrcRaw);

console.log('\nPortal tenant isolation — static checks\n');

// ── 0. The scan is actually looking at something ───────────────────────────
// Without this, a rename of the migration prefix turns every check below into
// a vacuous pass.
check('there are portal migrations to check at all',
  PORTAL_MIGRATIONS.length >= 5 && migSql.length > 4000,
  'found ' + PORTAL_MIGRATIONS.length + ' migration(s) — the 20260914* prefix stopped matching, so this file is asserting nothing');
check('there is runtime source to check at all',
  runtimeFiles.length > 50 && portalSrcRaw.length > 10000,
  'found ' + runtimeFiles.length + ' runtime file(s)');

// ── 1. Every new table carries a RESTRICTIVE tenant guard ──────────────────
const NEW_TABLES = [
  'projects',
  'project_milestones',
  'gl_internal_notes',
  'project_entitlement_events'
];
for (const t of NEW_TABLES) {
  const re = new RegExp('create policy "gl tenant guard" on public\\.' + t + '\\s+as restrictive', 'i');
  check('gl tenant guard is RESTRICTIVE on ' + t, re.test(migSql),
    'a permissive-only policy can be satisfied by any other permissive policy on the table');
}

// ── 2. No customer-facing views ────────────────────────────────────────────
// Ledger reads are RPCs. A view granted to authenticated is the design that was
// rejected twice; fail on it rather than re-litigate it.
check('no view is created by the portal migrations',
  !/\bcreate\s+(or\s+replace\s+)?view\b/i.test(migSql),
  'ledger reads must be security definer RPCs — a view exposes every column of its base table to anyone holding SELECT on it');
check('no view is granted to authenticated',
  !/grant\s+select\s+on\s+public\.[a-z_]+\s+to\s+authenticated/i.test(migSql) ||
  !/\bcreate\s+(or\s+replace\s+)?view\b/i.test(migSql),
  'a customer-facing view reintroduces the column-projection mistake');

// ── 3. Staff-only tables admit no customer ─────────────────────────────────
for (const t of ['gl_internal_notes', 'project_entitlement_events']) {
  const block = migSql.split(new RegExp('create policy [^;]*on public\\.' + t, 'i'))
    .slice(1).join(';');
  check(t + ' has no policy naming current_customer_client_id',
    !new RegExp('on public\\.' + t + '[\\s\\S]{0,400}?current_customer_client_id', 'i').test(migSql),
    'internal columns are protected by the ABSENCE of a customer policy, not by omitting them from a query');
  void block;
}

// ── 4. is_gl_staff, never is_staff_user ────────────────────────────────────
// is_staff_user() returns TRUE for an authenticated user with neither a profile
// nor a customer link — i.e. for a self-registered stranger, and signup is open.
check('no new policy or function uses is_staff_user()',
  !/is_staff_user\s*\(/i.test(stripSqlComments(migSql)),
  'use public.is_gl_staff(); see 20260730010000_is_staff_user_profile_wins.sql:18-36');

// ── 5. security definer hygiene ────────────────────────────────────────────
const defFns = [...migSql.matchAll(/create or replace function public\.([a-z_]+)\s*\(([^)]*)\)([\s\S]*?)\$fn\$;/gi)];
check('portal migrations define security definer functions', defFns.length >= 6,
  'found ' + defFns.length + ' — the function regex stopped matching');
for (const m of defFns) {
  const name = m[1];
  const body = m[3] || '';
  if (!/security definer/i.test(body)) continue;
  check(name + '() pins a search_path', /set search_path\s*=\s*pg_catalog/i.test(body),
    'an unpinned search_path lets a caller shadow an object the function resolves');
  // The role list varies — `from public, anon` on some, `from authenticated,
  // public, anon` on the trigger functions — so match public anywhere in it
  // rather than pinning it to first position.
  const revoked = new RegExp('revoke all on function public\\.' + name + '\\s*\\([^)]*\\)\\s+from[^;]*\\bpublic\\b', 'i');
  check(name + '() revokes execute from public', revoked.test(migSql),
    'PUBLIC holds EXECUTE on new functions by default');
}

// ── 5b. Trigger-only functions are not callable by anyone ──────────────────
// `revoke all ... from public, anon` is NOT sufficient on Supabase: the
// project's default privileges grant EXECUTE to `authenticated` separately, so
// a SECURITY DEFINER trigger function stays reachable at /rest/v1/rpc/<fn>
// until authenticated is revoked explicitly. Supabase lint 0029 caught all six
// of these minutes after they were first applied.
const TRIGGER_ONLY_FNS = [
  'gl_audit_actor_email',
  'gl_audit_milestone',
  'gl_audit_entitlement',
  'gl_audit_document_visibility',
  'gl_audit_artwork_project',
  'gl_stamp_project_milestones',
  'gl_guard_entitlement_append_only',
  'gl_stamp_entitlement_event'
];
for (const fn of TRIGGER_ONLY_FNS) {
  const revokedAuthed = new RegExp(
    'revoke all on function public\\.' + fn + '\\s*\\([^)]*\\)\\s+from[^;]*authenticated', 'i');
  check(fn + '() revokes EXECUTE from authenticated', revokedAuthed.test(stripSqlComments(migSql)),
    'revoking public/anon alone leaves it callable over REST — Supabase grants authenticated separately');
  const granted = new RegExp(
    'grant execute on function public\\.' + fn + '\\s*\\([^)]*\\)\\s+to', 'i');
  check(fn + '() is never granted EXECUTE', !granted.test(stripSqlComments(migSql)),
    'a trigger does not need EXECUTE to fire');
}
// The three that ARE meant to be called keep their grant — assert that too, so
// a blanket revoke cannot silently break the portal.
for (const fn of ['gl_portal_entitlements', 'gl_portal_formula_status', 'gl_can_read_formula']) {
  check(fn + '() keeps EXECUTE for authenticated',
    new RegExp('grant execute on function public\\.' + fn + '\\s*\\([^)]*\\)\\s+to authenticated', 'i')
      .test(stripSqlComments(migSql)),
    'the portal calls this; revoking it breaks the customer surface');
}

// ── 6. Ledger references cannot be cascaded away ───────────────────────────
check('gl_internal_notes references are ON DELETE RESTRICT',
  (migSql.match(/references public\.(projects|project_milestones|client_artwork|project_entitlement_events)\([a-z_]+\)\s+on delete restrict/gi) || []).length >= 4,
  'an immutable record a cascade can erase is not immutable');
check('no portal migration uses ON DELETE CASCADE',
  !/on delete cascade/i.test(migSql),
  'projects are archived, never deleted; history must survive');

// ── 7. The portal reads ledgers only through the approved RPCs ─────────────
const FORBIDDEN_PORTAL_READS = ['formulas', 'artwork_reviews', 'project_entitlement_events'];
for (const t of FORBIDDEN_PORTAL_READS) {
  check('portal does not query from(\'' + t + '\')',
    !new RegExp("from\\(\\s*['\"]" + t + "['\"]").test(portalSrc),
    'customers have no policy on this table; read it through its RPC');
}
for (const fn of ['gl_portal_formula_status', 'gl_portal_entitlements']) {
  check('portal calls ' + fn + '()', portalSrc.includes(fn),
    'the RPC is the only customer-facing path to this data');
}

// ── 8. No survivors of the abandoned view design ───────────────────────────
for (const dead of ['project_entitlements_current', 'client_artwork_state', 'gl_formula_client']) {
  check('no runtime reference to ' + dead, !runtimeSrc.includes(dead),
    'this artefact belongs to a rejected design; it must not come back');
}

// ── 9. Document visibility ─────────────────────────────────────────────────
check('deal_documents.client_visible defaults to false',
  /add column if not exists client_visible boolean not null default false/i.test(migSql),
  'a default of true would publish every future staff upload automatically');
check('the customer document policy requires client_visible',
  /client_visible\s*=\s*true\s*[\s\S]{0,40}AND/i.test(migSql),
  'client_visible must AND across both the assigned and unassigned branches');
check('the portal sets client_visible on customer uploads',
  /client_visible:\s*true/.test(portalSrc),
  'without it a customer uploads a file and it vanishes — reads as data loss');

// Staff need a way to publish. Phase 1 shipped the column and the policy but
// not the control, so every staff upload was internal with no way out short of
// SQL — and the release check "staff can publish or hide a document" could not
// be performed at all.
const dealDocsSrc = blankComments(readIfExists('src/modules/pipeline/deal-docs.js'));
check('staff can publish or hide a document from the CRM',
  /update\(\s*\{\s*client_visible:\s*makeVisible\s*\}\s*\)[\s\S]{0,80}\.select\(/.test(dealDocsSrc),
  'without this control every staff upload stays internal and the Atlas decision cannot be actioned');
check('the visibility toggle treats 0 updated rows as failure',
  /uq\.data\.length\s*===\s*0/.test(dealDocsSrc),
  'RLS rejects an unauthorized update silently — CLAUDE.md rule 4');
check('publishing a Formula document asks for a second confirmation',
  /doc_type\s*===\s*'Formula'/.test(dealDocsSrc),
  'the portal shows formula status only; a formula sheet can carry the formulation itself');

// ── 9b. The artwork decision ledger (phase 2) ──────────────────────────────
// client_artwork.status was writable by the customer under an unrestricted
// "customer update" policy. Harmless while nothing read it as authorization;
// the moment it meant "approved for print" a portal user could PATCH their own
// approval. The column is gone, and state is the ledger's latest row.
const artworkSrc = blankComments(readIfExists('src/modules/customers/artwork.js'));
const allRuntime = blankComments(runtimeSrc);

check('no runtime source references client_artwork.status',
  !/status\s*:\s*['"]submitted['"]/.test(allRuntime) && !/\.status\b/.test(artworkSrc),
  'the column was dropped in 20260915000000; a stale read renders every SKU as Submitted forever');
check('the portal reads artwork through gl_portal_artwork()',
  /rpc\(\s*['"]gl_portal_artwork['"]/.test(artworkSrc),
  'the RPC is the only customer-facing path; its return type has no decided_by');
check('artwork_reviews is append-only in the migration',
  /before update or delete on public\.artwork_reviews/i.test(migSql),
  'a decision that can be edited is not a record');
check('illegal artwork transitions are refused by the database',
  /sent_to_printer['"]?\s*then\s*false/i.test(migSql),
  'sent_to_printer is terminal; the UI map is a convenience, the trigger is the authority');
check('artwork_reviews has no customer policy',
  !/on public\.artwork_reviews[\s\S]{0,300}?current_customer_client_id/i.test(migSql),
  'a customer holding SELECT here could ask for decided_by');
check('the artwork decision write is checked for 0 rows',
  /r\.data\.length\s*===\s*0/.test(artworkSrc),
  'RLS rejects silently — CLAUDE.md rule 4');
// The guard must be a SECURITY DEFINER helper, not an inline subquery: a policy
// subquery runs as the CALLER, and customers hold no policy on artwork_reviews,
// so an inline `not exists` always sees zero rows and always permits the delete.
// 20260915000000 shipped it that way; 20260915000100 fixes it.
check('a reviewed SKU cannot be deleted by its client',
  /not public\.gl_artwork_has_decision\(id\)/i.test(migSql),
  'an inline subquery over artwork_reviews is invisible to the customer and permits everything');
// The superseded version is still in 20260915000000's text and in rollback
// notes, as history should be. What matters is the LAST definition, since that
// is the one in force.
const ddl = stripSqlComments(migSql);
const lastDeletePolicy = ddl.lastIndexOf('create policy "client_artwork customer delete"');
check('the delete guard in force uses the security definer helper',
  lastDeletePolicy !== -1 &&
    /gl_artwork_has_decision/.test(ddl.slice(lastDeletePolicy, lastDeletePolicy + 400)),
  'an inline subquery over artwork_reviews is invisible to the customer and permits everything');

// ── 9c. Downloads are named from the document, safely ──────────────────────
// Storage paths are opaque on purpose. The document's name travels separately
// as the Content-Disposition filename, and the EXTENSION always comes from the
// stored path — a document a client named "payload.exe" must still arrive as a
// .pdf, and a name cannot introduce a path separator.
const detailSrc = blankComments(readIfExists('src/modules/customers/client-detail.js'));
check('the download filename is derived from the document name',
  /glDocFileName/.test(detailSrc) && /download:\s*filename/.test(detailSrc),
  'without it every download lands as its storage id');
// Plain substring matches: the patterns being looked for are themselves regex
// literals, and escaping a regex that hunts for a regex is how you end up
// asserting nothing.
check('the download filename takes its extension from the stored path',
  detailSrc.includes("stored.split('.').pop()") && detailSrc.includes('[A-Za-z0-9]{1,8}$'),
  'a typed extension must not rename a PDF into something handled differently');
check('the download filename strips path separators',
  detailSrc.includes('[\\\\/:*?"<>|'),
  'a name containing a separator must not become a path');

// ── 10. Tenant consistency ─────────────────────────────────────────────────
for (const t of ['deal_documents', 'client_artwork']) {
  check(t + ' has a composite tenant foreign key',
    new RegExp('constraint ' + t + '_project_tenant[\\s\\S]{0,160}references public\\.projects \\(id, client_id\\)', 'i').test(migSql),
    'a plain FK on project_id cannot stop Client A\'s row joining Client B\'s project');
  check(t + ' requires client_id when project_id is set',
    new RegExp('constraint ' + t + '_project_needs_client', 'i').test(migSql),
    'both client_id columns are nullable and MATCH SIMPLE skips the FK when either side is null');
}

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
