-- Scope writes on the three public marketing tables to staff.
--
-- ROLLBACK:
--   drop policy if exists "case_studies staff all" on public.case_studies;
--   drop policy if exists "resources staff all"    on public.resources;
--   create policy "case_studies authed full" on public.case_studies
--     for all to authenticated using (true);
--   create policy "resources authed full" on public.resources
--     for all to authenticated using (true);
--   -- (the dropped duplicates below were redundant; recreate only if needed)
--
-- WHY
-- ---
-- capacity, case_studies and resources are the only three tables that carry a
-- 2026-05-18-era blanket policy AND sit outside the RESTRICTIVE tenant guard.
-- 20260807020000_tenant_isolation_guard.sql excluded them deliberately, on the
-- reasoning that they hold no client data — which is true. What it did not
-- account for is that they still carried `FOR ALL TO authenticated USING
-- (true)`, with nothing left to constrain it.
--
-- Effect before this migration: any authenticated user — every portal
-- customer, and before 20260828175051 any self-registered stranger — could
-- INSERT, UPDATE or DELETE the published case studies, the resource library
-- and the capacity badge shown on the public marketing site. Not a client-data
-- read, but a live defacement path, and a direct violation of CLAUDE.md rule 1.
--
-- VERIFIED AGAINST PRODUCTION 2026-08-28 before writing. pg_policies showed
-- these three are the ONLY tables with an unrestricted `authed all` and no
-- restrictive guard. The same drifted policy name also sits on cip_logs,
-- content_calendar, defects, formulas, nps_responses, production_runs,
-- sample_shipments, trade_shows, vendors and yield_logs — but all ten ARE
-- covered by `gl tenant guard`, which is RESTRICTIVE and therefore ANDs with
-- it, so those are constrained. They are recorded as debt, not fixed here:
-- dropping a permissive policy on a guarded table risks removing the only
-- grant staff rely on, and each needs its own check.
--
-- POLICY DRIFT — the more important finding
-- -----------------------------------------
-- `authed all`, `anon read` and `public read` appear in NO migration in this
-- repository. `<table> authed all` (20260518_rls_authed_all.sql) and
-- `<table> authed full` (20260516_new_feature_tables.sql) do. The unprefixed
-- ones were applied by hand in the Supabase dashboard — exactly the practice
-- CLAUDE.md rule 2 forbids, and exactly how the 2026-05-18 incident became
-- invisible to code review.
--
-- Reading the repository could not have found these. They were found by
-- querying pg_policies directly, which is the only reliable source of truth.
--
-- WHAT REPLACES THEM
-- ------------------
-- Public read is preserved: `capacity read public` (anon+authenticated, true)
-- and `case_studies|resources read public` (published = true) already provide
-- it, so the marketing site is unaffected. The dropped `anon read` and
-- `public read` were duplicates of those with identical expressions.
--
-- Writes now require staff. capacity already had `capacity admin write`
-- (role = 'admin'), which is left as-is — it was the intended write path all
-- along and was simply being bypassed. case_studies and resources had NO
-- staff-scoped write policy at all: the blanket ones were the only write path,
-- so dropping them without a replacement would lock staff out of editing the
-- marketing site. Hence the two new `staff all` policies.
--
-- is_gl_staff() rather than a role check, to match every other table and to
-- pick up the profiles-based definition fixed in 20260828175051.

-- ── 1. Remove the unrestricted grants ────────────────────────────────
-- Dashboard drift (in no migration):
drop policy if exists "authed all"  on public.capacity;
drop policy if exists "authed all"  on public.case_studies;
drop policy if exists "authed all"  on public.resources;
drop policy if exists "anon read"   on public.capacity;
drop policy if exists "anon read"   on public.case_studies;
drop policy if exists "anon read"   on public.resources;
drop policy if exists "public read" on public.capacity;
drop policy if exists "public read" on public.case_studies;
drop policy if exists "public read" on public.resources;

-- From 20260518_rls_authed_all.sql:
drop policy if exists "capacity authed all"     on public.capacity;
drop policy if exists "case_studies authed all" on public.case_studies;
drop policy if exists "resources authed all"    on public.resources;

-- From 20260516_new_feature_tables.sql:
drop policy if exists "case_studies authed full" on public.case_studies;
drop policy if exists "resources authed full"    on public.resources;

-- ── 2. Give staff a real write path ──────────────────────────────────
-- capacity keeps its existing "capacity admin write" (role = 'admin').
-- These two had none once the blanket policies were removed.
drop policy if exists "case_studies staff all" on public.case_studies;
create policy "case_studies staff all" on public.case_studies
  for all to authenticated
  using      (public.is_gl_staff())
  with check (public.is_gl_staff());

drop policy if exists "resources staff all" on public.resources;
create policy "resources staff all" on public.resources
  for all to authenticated
  using      (public.is_gl_staff())
  with check (public.is_gl_staff());

comment on table public.case_studies is
  'Public marketing content. Anon reads published rows; writes require staff (is_gl_staff()).';
comment on table public.resources is
  'Public marketing content. Anon reads published rows; writes require staff (is_gl_staff()).';
