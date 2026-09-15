-- ════════════════════════════════════════════════════════════════
-- Client portal v2 (1/5) — projects and milestones
-- ════════════════════════════════════════════════════════════════
-- The portal could show a client their invoices, runs and documents but not
-- where their project stood. A client has several concurrent projects (a brand
-- launching a lemon-lime and a ginger SKU on separate timelines), each with its
-- own milestone track.
--
-- Two shapes here are deliberate and easy to get wrong:
--
--   * round -- "sample sent -> feedback -> revisions -> sample sent" is a cycle,
--     not a line. Going around again INSERTS a row at round + 1 rather than
--     resetting the old one, so the history survives and the client sees
--     "Sample sent -- round 3". A single completed_at per milestone cannot say
--     that.
--
--   * track -- packaging/artwork runs PARALLEL to formulation. Flattened into
--     one left-to-right bar it would show a client at 60% while artwork sits
--     untouched. Two tracks, rendered as two indicators.
--
-- archived_at is the visibility switch and it is enforced HERE, in the policy,
-- not in a query the UI is trusted to write. status is a separate, constrained
-- lifecycle: whether the project is live, never where it is in the process.
-- A cancelled project stays visible and says so; an archived one is gone.
--
-- There is no DELETE grant on projects for any role, staff included. Archive is
-- the only exit, because entitlement history and milestone history reference
-- these rows and an audit trail a cascade can erase is not an audit trail.
--
-- ROLLBACK:
--   drop trigger if exists trg_projects_stamp_milestones on public.projects;
--   drop trigger if exists trg_project_milestones_audit on public.project_milestones;
--   drop trigger if exists trg_projects_updated_at on public.projects;
--   drop trigger if exists trg_project_milestones_updated_at on public.project_milestones;
--   drop function if exists public.gl_stamp_project_milestones();
--   drop function if exists public.gl_audit_milestone();
--   drop table if exists public.project_milestones;
--   drop table if exists public.projects;
--   drop function if exists public.gl_audit_actor_email();
--   Reverting removes the project spine entirely. Any milestone state staff
--   recorded is lost with it; nothing else in the CRM depends on these tables.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- Shared audit helper
-- ────────────────────────────────────────────────────────────────
-- current_setting('request.jwt.claims', true) returns an EMPTY STRING, not
-- null, when the GUC is unset -- and ''::jsonb raises
-- invalid_text_representation. The audit write shares the transaction with the
-- change it records, so that error would roll back every service-role and
-- background write. nullif before the cast is load-bearing.
create or replace function public.gl_audit_actor_email()
returns text
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(
    nullif(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'),
      ''),
    current_user);
$fn$;

revoke all on function public.gl_audit_actor_email() from public, anon;

-- ────────────────────────────────────────────────────────────────
-- projects
-- ────────────────────────────────────────────────────────────────
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete restrict,
  name            text not null,
  product_name    text,
  status          text not null default 'active'
                    check (status in ('active','on_hold','completed','cancelled')),
  project_manager uuid references public.profiles(id),
  image_path      text,
  started_on      date,
  target_date     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  -- Referenced by the composite tenant foreign keys in migration 5, which is
  -- how a document or artwork row is prevented from being attached to another
  -- client's project. A plain FK on project_id alone could not say that.
  constraint projects_id_client_uniq unique (id, client_id)
);

create index projects_client_live_idx
  on public.projects (client_id) where archived_at is null;

alter table public.projects enable row level security;
revoke all on public.projects from anon, public;
-- No DELETE. Archive is the only exit.
grant select, insert, update on public.projects to authenticated;

create policy "projects staff all" on public.projects
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

create policy "projects customer read" on public.projects
  for select to authenticated
  using (
    public.current_customer_client_id() is not null
    and client_id = public.current_customer_client_id()
    and archived_at is null
  );

create policy "gl tenant guard" on public.projects
  as restrictive to authenticated
  using (
    public.is_gl_staff()
    or (
      client_id::text = public.current_customer_client_id()::text
      and archived_at is null
    )
  );

-- ────────────────────────────────────────────────────────────────
-- project_milestones
-- ────────────────────────────────────────────────────────────────
-- EVERY column on this table is client-readable, because a client CAN read
-- every column on it. RLS is row-level; omitting a column from the portal's
-- select does not stop a direct PostgREST request for it. Internal commentary
-- therefore lives in gl_internal_notes (migration 3), a table customers hold no
-- policy on at all -- not in a column someone has to remember to leave out.
create table public.project_milestones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete restrict,
  track       text not null default 'formulation'
                check (track in ('formulation','artwork')),
  key         text not null,
  label       text not null,
  sort_order  int  not null,
  round       int  not null default 1 check (round >= 1),
  status      text not null default 'not_started'
                check (status in ('not_started','in_progress','awaiting_client',
                                  'completed','skipped','blocked')),
  owner       text not null default 'gl' check (owner in ('gl','client')),
  target_date date,
  completed_at timestamptz,
  client_note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_milestones_round_uniq unique (project_id, track, key, round)
);

create index project_milestones_project_idx
  on public.project_milestones (project_id, track, sort_order, round);

alter table public.project_milestones enable row level security;
revoke all on public.project_milestones from anon, public;
grant select, insert, update, delete on public.project_milestones to authenticated;

create policy "project_milestones staff all" on public.project_milestones
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

create policy "project_milestones customer read" on public.project_milestones
  for select to authenticated
  using (
    public.current_customer_client_id() is not null
    and exists (
      select 1 from public.projects p
      where p.id = project_milestones.project_id
        and p.client_id = public.current_customer_client_id()
        and p.archived_at is null
    )
  );

create policy "gl tenant guard" on public.project_milestones
  as restrictive to authenticated
  using (
    public.is_gl_staff()
    or exists (
      select 1 from public.projects p
      where p.id = project_milestones.project_id
        and p.client_id = public.current_customer_client_id()
        and p.archived_at is null
    )
  );

-- ────────────────────────────────────────────────────────────────
-- Milestone template
-- ────────────────────────────────────────────────────────────────
-- Stamped on insert so a project can never exist without its track. Editable
-- per project afterwards. sort_order is per-track: the artwork track has its
-- own sequence, which is what keeps the two progress indicators independent.
create or replace function public.gl_stamp_project_milestones()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  insert into public.project_milestones
    (project_id, track, key, label, sort_order, owner)
  values
    (new.id, 'formulation', 'intake',             'Project intake',      1,  'gl'),
    (new.id, 'formulation', 'formulation',        'Formulation',         2,  'gl'),
    (new.id, 'formulation', 'internal_testing',   'Internal testing',    3,  'gl'),
    (new.id, 'formulation', 'sample_prep',        'Sample preparation',  4,  'gl'),
    (new.id, 'formulation', 'sample_sent',        'Sample sent',         5,  'gl'),
    (new.id, 'formulation', 'client_feedback',    'Your feedback',       6,  'client'),
    (new.id, 'formulation', 'formula_revisions',  'Formula revisions',   7,  'gl'),
    (new.id, 'formulation', 'formula_approved',   'Formula approved',    8,  'client'),
    (new.id, 'formulation', 'awaiting_pa_letter', 'Awaiting PA letter',  9,  'gl'),
    (new.id, 'formulation', 'pa_letter_obtained', 'PA letter obtained',  10, 'gl'),
    (new.id, 'formulation', 'production_ready',   'Production ready',    11, 'gl'),
    (new.id, 'formulation', 'complete',           'Complete',            12, 'gl'),
    (new.id, 'artwork',     'packaging_artwork',  'Packaging and artwork', 1, 'gl');
  return new;
end
$fn$;

revoke all on function public.gl_stamp_project_milestones() from public, anon;

create trigger trg_projects_stamp_milestones
  after insert on public.projects
  for each row execute function public.gl_stamp_project_milestones();

-- ────────────────────────────────────────────────────────────────
-- Audit
-- ────────────────────────────────────────────────────────────────
-- Written by a trigger, not by the browser. A client-side glAudit() call that
-- the caller simply omits leaves no trace; a trigger cannot be skipped. The
-- write shares the transaction, so an unauditable change to milestone state
-- does not happen at all -- that is the intended behaviour, not a side effect.
create or replace function public.gl_audit_milestone()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_source text := case when auth.uid() is null then 'system' else 'user' end;
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            'milestone_status_changed', new.id::text,
            jsonb_build_object('source', v_source, 'db_role', current_user,
                               'project_id', new.project_id, 'track', new.track,
                               'key', new.key, 'round', new.round,
                               'from', old.status, 'to', new.status));
  end if;

  if new.client_note is distinct from old.client_note
     and coalesce(new.client_note, '') <> '' then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            'milestone_client_note_published', new.id::text,
            jsonb_build_object('source', v_source, 'db_role', current_user,
                               'project_id', new.project_id, 'key', new.key,
                               'round', new.round,
                               'note_length', length(new.client_note)));
  end if;

  return new;
end
$fn$;

revoke all on function public.gl_audit_milestone() from public, anon;

create trigger trg_project_milestones_audit
  after update on public.project_milestones
  for each row execute function public.gl_audit_milestone();

-- updated_at, matching 20260830210000_maintain_updated_at.sql
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger trg_project_milestones_updated_at
  before update on public.project_milestones
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
