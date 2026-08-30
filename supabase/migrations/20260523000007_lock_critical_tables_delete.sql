-- ============================================================
-- Lock destructive ops on the remaining high-value tables
-- ============================================================
-- Extends the super-user enforcement from 20260523_super_user_rls_enforcement.sql
-- to every other table where bulk-DELETE from DevTools by a hostile or
-- mistaken admin would be catastrophic. Mike's call-out 2026-05-23
-- ("protect them all") closes the remaining gap.
--
-- Two tiers:
--
--   Tier 1 (never deletable — append-only audit trail):
--     • audit_log
--   No DELETE policy at all. RLS with no matching DELETE policy = no
--   one can delete, even the super user via the JS client. To purge
--   the audit log you'd have to use the Supabase dashboard
--   service-role key, which is admin-out-of-band by design.
--
--   Tier 2 (super-user only DELETE, staff still SELECT/INSERT/UPDATE):
--     • compliance_records   — FDA-defensible records
--     • formulas             — intellectual property
--     • cip_logs             — cleaning cycle history
--     • documents            — artwork / contracts / COAs index
--     • defects              — NCR log (audit trail)
--     • hold_tags            — DO NOT SHIP locks (lifecycle history)
--     • yield_logs           — production yield history
--     • sample_shipments     — sample tracking history
--     • vendors              — supplier directory + COI history
--
-- For each Tier 2 table the existing `for all to authenticated using
-- (true)` policy (if present) is dropped and replaced with explicit
-- per-verb policies. The DELETE policy gates on public.is_super_user().
--
-- Day-to-day work is unaffected — staff continue to read, insert, and
-- update freely. Only DELETE is locked to the super user (and audit_log
-- DELETE is impossible).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── audit_log: append-only, no DELETE policy at all ──────────
-- Drop any existing permissive policies first, then re-create
-- SELECT + INSERT only. No DELETE = no one can delete via the JS
-- client. UPDATE also blocked since audit rows should never change.
drop policy if exists "audit_log authed" on public.audit_log;
drop policy if exists "audit_log authed select" on public.audit_log;
drop policy if exists "audit_log authed insert" on public.audit_log;
drop policy if exists "audit_log read all authed" on public.audit_log;
drop policy if exists "audit_log insert authed" on public.audit_log;
drop policy if exists "audit_log staff select" on public.audit_log;
drop policy if exists "audit_log staff insert" on public.audit_log;

create policy "audit_log staff select" on public.audit_log
  for select to authenticated using (public.is_staff_user());

create policy "audit_log staff insert" on public.audit_log
  for insert to authenticated with check (public.is_staff_user());

-- Intentionally NO update/delete policies — audit rows are immutable.
-- The inspector_read policy from 20260523_inspector_mode_server_side.sql
-- adds the anon SELECT path with a valid token; it stays in place.

-- ── compliance_records ──────────────────────────────────────
drop policy if exists "compliance_records authed" on public.compliance_records;
drop policy if exists "compliance_records staff select" on public.compliance_records;
drop policy if exists "compliance_records staff insert" on public.compliance_records;
drop policy if exists "compliance_records staff update" on public.compliance_records;
drop policy if exists "compliance_records super delete" on public.compliance_records;

create policy "compliance_records staff select" on public.compliance_records
  for select to authenticated using (public.is_staff_user());
create policy "compliance_records staff insert" on public.compliance_records
  for insert to authenticated with check (public.is_staff_user());
create policy "compliance_records staff update" on public.compliance_records
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "compliance_records super delete" on public.compliance_records
  for delete to authenticated using (public.is_super_user());

-- ── formulas ────────────────────────────────────────────────
drop policy if exists "formulas authed" on public.formulas;
drop policy if exists "formulas staff select" on public.formulas;
drop policy if exists "formulas staff insert" on public.formulas;
drop policy if exists "formulas staff update" on public.formulas;
drop policy if exists "formulas super delete" on public.formulas;

create policy "formulas staff select" on public.formulas
  for select to authenticated using (public.is_staff_user());
create policy "formulas staff insert" on public.formulas
  for insert to authenticated with check (public.is_staff_user());
create policy "formulas staff update" on public.formulas
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "formulas super delete" on public.formulas
  for delete to authenticated using (public.is_super_user());

-- ── cip_logs ────────────────────────────────────────────────
drop policy if exists "cip_logs authed" on public.cip_logs;
drop policy if exists "cip_logs staff select" on public.cip_logs;
drop policy if exists "cip_logs staff insert" on public.cip_logs;
drop policy if exists "cip_logs staff update" on public.cip_logs;
drop policy if exists "cip_logs super delete" on public.cip_logs;

create policy "cip_logs staff select" on public.cip_logs
  for select to authenticated using (public.is_staff_user());
create policy "cip_logs staff insert" on public.cip_logs
  for insert to authenticated with check (public.is_staff_user());
create policy "cip_logs staff update" on public.cip_logs
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "cip_logs super delete" on public.cip_logs
  for delete to authenticated using (public.is_super_user());

-- ── documents ──────────────────────────────────────────────
drop policy if exists "documents authed" on public.documents;
drop policy if exists "documents staff all" on public.documents;
drop policy if exists "documents staff select" on public.documents;
drop policy if exists "documents staff insert" on public.documents;
drop policy if exists "documents staff update" on public.documents;
drop policy if exists "documents super delete" on public.documents;

create policy "documents staff select" on public.documents
  for select to authenticated using (public.is_staff_user());
create policy "documents staff insert" on public.documents
  for insert to authenticated with check (public.is_staff_user());
create policy "documents staff update" on public.documents
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "documents super delete" on public.documents
  for delete to authenticated using (public.is_super_user());

-- ── defects ────────────────────────────────────────────────
drop policy if exists "defects authed" on public.defects;
drop policy if exists "defects staff select" on public.defects;
drop policy if exists "defects staff insert" on public.defects;
drop policy if exists "defects staff update" on public.defects;
drop policy if exists "defects super delete" on public.defects;

create policy "defects staff select" on public.defects
  for select to authenticated using (public.is_staff_user());
create policy "defects staff insert" on public.defects
  for insert to authenticated with check (public.is_staff_user());
create policy "defects staff update" on public.defects
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "defects super delete" on public.defects
  for delete to authenticated using (public.is_super_user());

-- ── hold_tags ──────────────────────────────────────────────
drop policy if exists "hold_tags authed" on public.hold_tags;
drop policy if exists "hold_tags staff select" on public.hold_tags;
drop policy if exists "hold_tags staff insert" on public.hold_tags;
drop policy if exists "hold_tags staff update" on public.hold_tags;
drop policy if exists "hold_tags super delete" on public.hold_tags;

create policy "hold_tags staff select" on public.hold_tags
  for select to authenticated using (public.is_staff_user());
create policy "hold_tags staff insert" on public.hold_tags
  for insert to authenticated with check (public.is_staff_user());
create policy "hold_tags staff update" on public.hold_tags
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "hold_tags super delete" on public.hold_tags
  for delete to authenticated using (public.is_super_user());

-- ── yield_logs ─────────────────────────────────────────────
drop policy if exists "yield_logs authed" on public.yield_logs;
drop policy if exists "yield_logs staff select" on public.yield_logs;
drop policy if exists "yield_logs staff insert" on public.yield_logs;
drop policy if exists "yield_logs staff update" on public.yield_logs;
drop policy if exists "yield_logs super delete" on public.yield_logs;

create policy "yield_logs staff select" on public.yield_logs
  for select to authenticated using (public.is_staff_user());
create policy "yield_logs staff insert" on public.yield_logs
  for insert to authenticated with check (public.is_staff_user());
create policy "yield_logs staff update" on public.yield_logs
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "yield_logs super delete" on public.yield_logs
  for delete to authenticated using (public.is_super_user());

-- ── sample_shipments ──────────────────────────────────────
drop policy if exists "sample_shipments authed" on public.sample_shipments;
drop policy if exists "sample_shipments staff select" on public.sample_shipments;
drop policy if exists "sample_shipments staff insert" on public.sample_shipments;
drop policy if exists "sample_shipments staff update" on public.sample_shipments;
drop policy if exists "sample_shipments super delete" on public.sample_shipments;

create policy "sample_shipments staff select" on public.sample_shipments
  for select to authenticated using (public.is_staff_user());
create policy "sample_shipments staff insert" on public.sample_shipments
  for insert to authenticated with check (public.is_staff_user());
create policy "sample_shipments staff update" on public.sample_shipments
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "sample_shipments super delete" on public.sample_shipments
  for delete to authenticated using (public.is_super_user());

-- ── vendors ────────────────────────────────────────────────
drop policy if exists "vendors authed" on public.vendors;
drop policy if exists "vendors staff select" on public.vendors;
drop policy if exists "vendors staff insert" on public.vendors;
drop policy if exists "vendors staff update" on public.vendors;
drop policy if exists "vendors super delete" on public.vendors;

create policy "vendors staff select" on public.vendors
  for select to authenticated using (public.is_staff_user());
create policy "vendors staff insert" on public.vendors
  for insert to authenticated with check (public.is_staff_user());
create policy "vendors staff update" on public.vendors
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "vendors super delete" on public.vendors
  for delete to authenticated using (public.is_super_user());

notify pgrst, 'reload schema';
