#!/usr/bin/env node
/* ============================================================================
   PORTAL CORRECTIONS — Codex handoff CP01–CP10 (2026-09-17)
   ----------------------------------------------------------------------------
   The static half. It proves the migrations DEFINE the guards and the client
   code USES them. It does not prove the database behaves: that is
   scripts/portal-isolation-proof.sql, run against production (20 assertions,
   all passing, 2026-09-17). Source-string checks are not a substitute for that
   run — they exist so the next edit cannot quietly undo a fix.

   Run:  node tests/portal-corrections.test.cjs
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const rd = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } };
// SQL with -- comments removed: ROLLBACK notes and history quote the old code.
const sqlCode = t => t.replace(/--[^\n]*/g, '');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + detail);
}

const m1 = rd('supabase/migrations/20260917090000_portal_file_provenance.sql');
const m2 = rd('supabase/migrations/20260917090100_portal_records_and_notifications.sql');
check('both correction migrations exist', !!m1 && !!m2);

// ── CP01 ───────────────────────────────────────────────────────────────────
const custRefCheck = /file_path like public\.current_customer_client_id\(\)::text \|\| '\/portal\/%'/g;
check('CP01 customer document and artwork inserts are confined to <client>/portal/',
  (m1.match(custRefCheck) || []).length >= 2 &&
  /create policy "deal_documents customer upload"[\s\S]{0,600}?\/portal\/%/.test(m1) &&
  /create policy "client_artwork customer insert"[\s\S]{0,600}?\/portal\/%/.test(m1),
  'a customer-authored row could point storage at any object');
check('CP01 customers upload only into <client>/portal/',
  /create policy "client-docs customer upload"[\s\S]{0,300}?name like public\.current_customer_client_id\(\)::text \|\| '\/portal\/%'/.test(m1));
check('CP01 the blanket "<client>/portal/% is readable" branch is gone; unreferenced own uploads only',
  /objects\.owner_id = auth\.uid\(\)::text\s+and not public\.gl_storage_object_referenced\(objects\.name\)/.test(m1));
check('CP01 portal uploads use the portal namespace in the UI',
  /\(portal \? '\/portal\/artwork\/' : '\/artwork\/'\)/.test(rd('src/modules/customers/artwork.js')) &&
  /customer\.client_id \+ '\/portal\/'/.test(rd('src/modules/customers/portal-customer.js')));

// ── CP02 ───────────────────────────────────────────────────────────────────
check('CP02 customers have no UPDATE policy on client_artwork',
  /drop policy if exists "client_artwork customer update" on public\.client_artwork;/.test(m1) &&
  !/create policy "client_artwork customer update"/.test(sqlCode(m1)));
check('CP02 reviewed artwork file identity is immutable, and decisions bind to the file',
  /has review decisions, so its file is part of the record/.test(m1) &&
  /new\.artwork_file_path := v_file;/.test(m1) &&
  /for update;\s*new\.artwork_file_path/.test(m1));
check('CP02 storage refuses to delete or overwrite a record file',
  /as restrictive for delete to authenticated[\s\S]{0,120}gl_storage_object_is_record/.test(m1) &&
  /as restrictive for update to authenticated[\s\S]{0,120}gl_storage_object_is_record/.test(m1));
check('CP02 revisions are new rows linked by supersedes_id, offered in the UI',
  /supersedes_id uuid references public\.client_artwork\(id\)/.test(m1) &&
  /gl-art-revise/.test(rd('src/modules/customers/artwork.js')));

// ── CP03 ───────────────────────────────────────────────────────────────────
const fd = rd('src/modules/customers/formula-docs.js');
check('CP03 formula document removal deletes the record before the file',
  fd.indexOf(".from('formula_documents').delete()") > -1 &&
  fd.indexOf(".from('formula_documents').delete()") < fd.indexOf("storage.from('client-docs').remove([row.file_path])"),
  'file-first deletion left a document that pointed at nothing');
check('CP03 superseding keeps a downloaded document and frees its kind for the correction',
  /create unique index if not exists formula_documents_current_kind_uniq[\s\S]{0,120}where superseded_at is null/.test(m2) &&
  /a superseded formula document cannot be published/.test(m2) &&
  /gl-fd-supersede/.test(fd));

// ── CP04 ───────────────────────────────────────────────────────────────────
const pc = rd('src/modules/customers/portal-customer.js');
check('CP04 portal documents are scoped to the active project, unassigned ones labelled',
  /function docScope\(d\)/.test(pc) && /EARLIER — NOT ASSIGNED TO A PROJECT/.test(pc) &&
  /select\('id, doc_type, name, notes, file_path, created_at, project_id'\)/.test(pc));
check('CP04 portal uploads and artwork carry the active project',
  /project_id: activeProject \? activeProject\.id : null,/.test(pc) &&
  /glRenderArtwork\(customer\.client_id, artMount, \{ portal: true, projectId:/.test(pc) &&
  /project_id: projectId, supersedes_id:/.test(rd('src/modules/customers/artwork.js')));
check('CP04 deliverables are not duplicated in the general list; delivered files survive a lock',
  /!DELIVERABLE_TYPES\[d\.doc_type\]/.test(pc) && /function deliveredWhileLocked/.test(pc));

// ── CP05 ───────────────────────────────────────────────────────────────────
check('CP05 base-table artwork read applies the project-archive rule',
  /create policy "client_artwork customer read"[\s\S]{0,500}?p\.archived_at is null/.test(m1));

// ── CP06 ───────────────────────────────────────────────────────────────────
check('CP06 decided_by and entitlement actor are stamped from auth.uid()',
  /new\.decided_by := auth\.uid\(\);/.test(m1) && /new\.actor := auth\.uid\(\);/.test(m1));

// ── CP07 ───────────────────────────────────────────────────────────────────
check('CP07 accepted quotes are locked in the database',
  /create trigger trg_quotes_accepted_lock\s+before update on public\.quotes/.test(m2) &&
  /its project and services are locked/.test(m2) &&
  /is for an archived project; restore the project before accepting/.test(m2));
const qb = rd('src/modules/quotes/quote-builder.js');
check('CP07 the editor locks accepted quotes and reports the ledger, not a promise',
  /ACCEPTED — LOCKED/.test(qb) && /these are NOT unlocked:/.test(qb) &&
  !/'Saved — services unlocked for the client\.'/.test(qb));

// ── CP08 ───────────────────────────────────────────────────────────────────
check('CP08 document and artwork notifications apply the archived-project rule',
  /create or replace function public\.gl_notify_document\(\)[\s\S]{0,600}?p\.archived_at is null/.test(m2) &&
  /create or replace function public\.gl_notify_artwork_decision\(\)[\s\S]{0,700}?p\.archived_at is null/.test(m2));
check('CP08 every portal email records its event, re-checked at send time',
  /portal_event jsonb/.test(m2) && /function public\.gl_portal_email_block_reason/.test(m2) &&
  /gl_portal_email_block_reason", \{ p_schedule_id: row\.id \}/.test(rd('supabase/functions/email-scheduler/index.ts')) &&
  /status: "skipped"/.test(rd('supabase/functions/email-scheduler/index.ts')));
check('CP08 the queue admits the status the scheduler claims with',
  /check \(status = any \(array\['pending','sending','sent','failed','cancelled','skipped'\]\)\)/.test(m2),
  "email_schedule_status_check never allowed 'sending', so no scheduled email was ever sent");

// ── CP09 ───────────────────────────────────────────────────────────────────
const pa = rd('src/modules/customers/projects-admin.js');
check('CP09 staff can edit project details, milestone target and owner, add rounds, preview',
  /window\.glProjectEditDetails = /.test(pa) && /window\.glMilestoneSetTarget = /.test(pa) &&
  /window\.glMilestoneSetOwner = /.test(pa) && /window\.glMilestoneNewRound = /.test(pa) &&
  /window\.glProjectPreviewAsClient = /.test(pa));
check('CP09 reopening a milestone clears its completion time',
  /completed_at: value === 'completed' \? new Date\(\)\.toISOString\(\) : null/.test(pa));
const reg = rd('src/shared/action-registry.js');
check('CP09 new admin actions are registered with the dispatcher',
  ['glProjectEditDetails', 'glProjectPreviewAsClient', 'glMilestoneSetTarget', 'glMilestoneSetOwner', 'glMilestoneNewRound']
    .every(a => reg.includes("'" + a + "'")));

// ── CP10 ───────────────────────────────────────────────────────────────────
const proof = rd('scripts/portal-isolation-proof.sql');
check('CP10 the isolation proof has no UPDATE ... LIMIT and treats missing fixtures as INCOMPLETE',
  !/update[^;]*\blimit\s+\d/i.test(proof.replace(/--[^\n]*/g, '')) &&
  /PORTAL ISOLATION PROOF: INCOMPLETE/.test(proof));
check('CP10 PUBLIC is read from the ACL, not asked as a role',
  /aclexplode\(p\.proacl\) a where a\.grantee = 0/.test(proof) &&
  !/has_function_privilege\('public'/.test(sqlCode(proof)));
check('CP10 the proof covers CP01–CP08 and all six identities',
  ['CP01', 'CP02', 'CP03', 'CP05', 'CP06', 'CP07', 'CP08', 'deactivated customer', 'authenticated stranger', 'anonymous caller', 'another client']
    .every(t => proof.includes(t)));

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
