-- ════════════════════════════════════════════════════════════════
-- Client portal v2 (3/5) — internal notes
-- ════════════════════════════════════════════════════════════════
-- Staff need somewhere to write things a client must never read. The obvious
-- design -- an `internal_note` column on project_milestones, omitted from the
-- portal's select -- does not work, and the reason is worth stating plainly
-- because it is the mistake this whole plan was revised twice to remove:
--
--   RLS IS ROW-LEVEL, NOT COLUMN-LEVEL.
--
-- A customer with SELECT on a table can request any column on the rows they can
-- see. `?select=internal_note` bypasses whatever the UI asked for. A view that
-- omits the column does not help either, because a security_invoker view still
-- requires the caller to hold SELECT on the base table. The only columns a
-- customer cannot read are the ones on a table they hold NO POLICY on.
--
-- Hence this table, with a staff-only permissive policy AND a staff-only
-- restrictive guard, and nothing granting a customer anything. A customer's
-- select returns zero rows because no policy admits them.
--
-- Four real foreign keys instead of a (scope, ref_id) pair: a polymorphic
-- reference cannot be enforced by the database, so a note could outlive or
-- mis-target its subject. num_nonnulls() pins it to exactly one.
--
-- This migration is third because entitlement_seq references the ledger created
-- in migration 2. Ordering it earlier would be a forward reference, which
-- tests/migration-replayable.test.cjs rejects.
--
-- ROLLBACK:
--   drop table if exists public.gl_internal_notes;
--   Reverting deletes all internal commentary. It is staff-only working notes;
--   no client-facing surface reads it and nothing else references it.

set search_path = public, extensions;

create table public.gl_internal_notes (
  seq             bigint generated always as identity primary key,
  project_id      uuid   references public.projects(id)                    on delete restrict,
  milestone_id    uuid   references public.project_milestones(id)          on delete restrict,
  artwork_id      uuid   references public.client_artwork(id)              on delete restrict,
  entitlement_seq bigint references public.project_entitlement_events(seq) on delete restrict,
  body            text not null,
  author          uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  constraint gl_internal_notes_one_target
    check (num_nonnulls(project_id, milestone_id, artwork_id, entitlement_seq) = 1)
);

create index gl_internal_notes_project_idx   on public.gl_internal_notes (project_id)   where project_id is not null;
create index gl_internal_notes_milestone_idx on public.gl_internal_notes (milestone_id) where milestone_id is not null;
create index gl_internal_notes_artwork_idx   on public.gl_internal_notes (artwork_id)   where artwork_id is not null;

alter table public.gl_internal_notes enable row level security;
revoke all on public.gl_internal_notes from anon, public;
grant select, insert, update, delete on public.gl_internal_notes to authenticated;

create policy "gl_internal_notes staff all" on public.gl_internal_notes
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

-- Both layers say staff-only, independently, and both name is_gl_staff().
--
-- CORRECTED 2026-09-15. This comment used to justify that choice by saying
-- is_staff_user() returns TRUE for a self-registered stranger. That is false,
-- and it was false when written. Probed live as an authenticated user with no
-- profile row: is_staff_user() returns false, exactly as is_gl_staff() does.
-- The permissive fallback that once made them differ was removed by
-- 20260807030000, which is LATER than the 20260730010000 this claim cited --
-- the citation pointed at a version of the function that no longer exists.
--
-- The two functions now have identical bodies. is_gl_staff() is still the right
-- name here, but for a plainer reason: it is the helper the RESTRICTIVE tenant
-- guard and every phase-1 policy use, so there is ONE name to grep when the
-- staff definition next changes -- and two identical functions is itself a
-- hazard, because a future fix to one silently misses the other.
create policy "gl tenant guard" on public.gl_internal_notes
  as restrictive to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

notify pgrst, 'reload schema';
