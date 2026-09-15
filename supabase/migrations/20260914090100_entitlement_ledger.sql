-- ════════════════════════════════════════════════════════════════
-- Client portal v2 (2/5) — entitlement ledger
-- ════════════════════════════════════════════════════════════════
-- Which premium services a client has bought decides which portal tabs unlock.
-- Locked tabs are the sales surface, so this is commercial state, not a UI
-- preference, and it is never hard-coded in the interface or inferred from a
-- string match on a quote line.
--
-- An append-only LEDGER, not a mutable row per service: grant -> revoke ->
-- re-grant is three preserved events. There is deliberately NO
-- unique (project_id, service_key), because a unique row would have to be
-- overwritten and the history of who granted what, when, would be lost -- which
-- for a billing-adjacent record is the whole point.
--
-- Entitlements hang off the PROJECT, not the client. A brand may buy renders
-- for its launch SKU and not for the second flavour; a client-level flag cannot
-- express that and would unlock the tab on every project at once.
--
-- CUSTOMERS HOLD NO POLICY ON THIS TABLE. Reads go through
-- gl_portal_entitlements(), which filters by tenant internally and returns a
-- fixed column list containing no actor. This is not decoration: RLS is
-- row-level, so had customers held SELECT here, a view that merely omitted
-- `actor` would still leave `?select=actor` one request away. The only columns
-- a customer cannot read are the ones on a table they have no policy on.
--
-- ROLLBACK:
--   drop function if exists public.gl_portal_entitlements();
--   drop trigger if exists trg_entitlement_events_append_only on public.project_entitlement_events;
--   drop trigger if exists trg_entitlement_events_stamp on public.project_entitlement_events;
--   drop trigger if exists trg_entitlement_events_audit on public.project_entitlement_events;
--   drop function if exists public.gl_guard_entitlement_append_only();
--   drop function if exists public.gl_stamp_entitlement_event();
--   drop function if exists public.gl_audit_entitlement();
--   drop table if exists public.project_entitlement_events;
--   Reverting drops the record of every grant and revocation. Nothing else
--   reads it; every portal tab would fall back to locked.

set search_path = public, extensions;

create table public.project_entitlement_events (
  seq         bigint generated always as identity primary key,
  project_id  uuid not null references public.projects(id) on delete restrict,
  service_key text not null
                check (service_key in ('renders','packaging_artwork','market_analytics')),
  action      text not null check (action in ('grant','revoke')),
  actor       uuid not null references public.profiles(id),
  at          timestamptz not null default now(),
  note        text
);

create index project_entitlement_events_current_idx
  on public.project_entitlement_events (project_id, service_key, seq desc);

alter table public.project_entitlement_events enable row level security;
revoke all on public.project_entitlement_events from anon, public;
-- No delete, no update: the ledger is append-only and the grant reflects that
-- as well as the trigger below. Two layers, neither relied on alone.
grant select, insert on public.project_entitlement_events to authenticated;

create policy "entitlement_events staff all" on public.project_entitlement_events
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

create policy "gl tenant guard" on public.project_entitlement_events
  as restrictive to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

-- ────────────────────────────────────────────────────────────────
-- Append-only, and the timestamp is ours
-- ────────────────────────────────────────────────────────────────
-- seq is the order, not `at`. Two events inside the same millisecond still sort
-- deterministically, so "current" is order by seq desc limit 1 and never
-- order by at.
create or replace function public.gl_guard_entitlement_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  raise exception
    'entitlement event % is immutable; record a new grant or revoke instead',
    coalesce(old.seq, 0)
    using errcode = '42501';
end
$fn$;

create trigger trg_entitlement_events_append_only
  before update or delete on public.project_entitlement_events
  for each row execute function public.gl_guard_entitlement_append_only();

-- `at` is overwritten, not range-checked. There is no legitimate reason for a
-- caller to name this timestamp, so a supplied value is discarded rather than
-- validated.
create or replace function public.gl_stamp_entitlement_event()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  new.at := now();
  return new;
end
$fn$;

create trigger trg_entitlement_events_stamp
  before insert on public.project_entitlement_events
  for each row execute function public.gl_stamp_entitlement_event();

create or replace function public.gl_audit_entitlement()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  insert into public.audit_log (actor_id, actor_email, action, target, details)
  values (auth.uid(), public.gl_audit_actor_email(),
          case when new.action = 'grant'
               then 'entitlement_granted' else 'entitlement_revoked' end,
          new.project_id::text,
          jsonb_build_object(
            'source', case when auth.uid() is null then 'system' else 'user' end,
            'db_role', current_user,
            'service_key', new.service_key,
            'seq', new.seq));
  return new;
end
$fn$;

revoke all on function public.gl_audit_entitlement() from public, anon;

create trigger trg_entitlement_events_audit
  after insert on public.project_entitlement_events
  for each row execute function public.gl_audit_entitlement();

-- ────────────────────────────────────────────────────────────────
-- The only customer-facing read
-- ────────────────────────────────────────────────────────────────
-- No `actor` in the return type: a client has no reason to receive an internal
-- profiles UUID. Archived projects are excluded here as well as in the
-- projects policy, so an archived project cannot leak an entitlement.
create or replace function public.gl_portal_entitlements()
returns table (project_id uuid, service_key text, action text, at timestamptz)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select distinct on (e.project_id, e.service_key)
         e.project_id, e.service_key, e.action, e.at
  from public.project_entitlement_events e
  join public.projects p on p.id = e.project_id
  where public.current_customer_client_id() is not null
    and p.client_id = public.current_customer_client_id()
    and p.archived_at is null
  order by e.project_id, e.service_key, e.seq desc;
$fn$;

revoke all on function public.gl_portal_entitlements() from public, anon;
grant execute on function public.gl_portal_entitlements() to authenticated;

notify pgrst, 'reload schema';
