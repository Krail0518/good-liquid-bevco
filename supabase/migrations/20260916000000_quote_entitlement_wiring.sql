-- ════════════════════════════════════════════════════════════════
-- Client portal v2 — phase 4b: an accepted quote unlocks what it sold
-- ════════════════════════════════════════════════════════════════
-- Phase 1 built the locked tabs and phase 4a told the client when something
-- needed them. The join between the two was still manual: staff sold a service,
-- then had to remember to tick it on the project, or the client kept looking at
-- a sales pitch for something they had already paid for.
--
-- WHAT WAS ACTUALLY THERE, because the plan's phrase "quote -> entitlement
-- wiring" assumed more than the schema had:
--
--   * quotes.status already admits 'accepted' (draft|sent|accepted|declined),
--     but no quote has ever left 'draft' -- all 3 are drafts, and the builder
--     hardcodes 'draft' on save. So this is the first code to treat acceptance
--     as an event at all.
--   * quotes.addons looked promising and is not: its entries are PRODUCTION
--     options (nitrogen dosing, tray packing, palletizing), not the three
--     portal services. Nothing in a quote named a service.
--   * quotes carry client_id, entitlements are per PROJECT, and a client may
--     have several. There was no column saying which project a quote is for.
--
-- So the wiring needs two facts a quote did not record: WHICH PROJECT, and
-- WHICH SERVICES. Both are added here as explicit staff-set columns rather than
-- inferred from line-item text. Guessing a billing-adjacent grant from prose
-- would be the same class of mistake as deriving a status from a cached column:
-- it works until someone edits the wording.
--
-- WHEN NOTHING IS SET, NOTHING HAPPENS. A quote accepted without a project or
-- without services grants nothing and raises no error. A silent no-op is the
-- right failure here -- the alternative is guessing which project the money was
-- for, and a wrong grant shows another client's service tab as bought.
--
-- IT NEEDS A REAL PERSON. The ledger's actor is NOT NULL and references
-- profiles, because phase 1 decided a grant must name who made it. auth.uid()
-- is null for the service role or a background job, so an acceptance that would
-- grant something without a signed-in user RAISES rather than granting
-- anonymously. Staff accept quotes from a browser session, so the real path is
-- unaffected; this was found by the rollback probe on the first run.
--
-- IDEMPOTENT. The grant only fires where the ledger's latest event for that
-- (project, service) is not already 'grant', so re-accepting a quote, or
-- accepting a second quote covering the same service, adds nothing. If staff
-- revoked in between, re-accepting legitimately re-grants -- that is the ledger
-- working as designed, and the history keeps all three events.
--
-- The entitlement audit trigger from 20260914090100 already fires on insert, so
-- this writes no audit row of its own; doing so would double-record the grant.
--
-- ROLLBACK:
--   drop trigger if exists trg_quote_grant_entitlements on public.quotes;
--   drop function if exists public.gl_quote_grant_entitlements();
--   alter table public.quotes
--     drop constraint if exists quotes_project_tenant,
--     drop constraint if exists quotes_project_needs_client,
--     drop constraint if exists quotes_services_known,
--     drop column if exists project_id,
--     drop column if exists services;
--   Reverting stops quotes from unlocking anything. Entitlements already
--   granted stay granted -- they are ledger events, not derived state -- and
--   staff can still grant and revoke by hand in the project admin UI.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- What a quote has to record for the wiring to mean anything
-- ────────────────────────────────────────────────────────────────
alter table public.quotes
  add column if not exists project_id uuid,
  add column if not exists services   text[] not null default '{}';

-- Tenant consistency is declarative, exactly as it is for deal_documents and
-- client_artwork (20260914090400): a composite key so Client A's quote cannot
-- name Client B's project through ANY write path, not just the staff UI.
--
-- The companion CHECK is required, not decorative: quotes.client_id is
-- nullable (2 of the 3 live quotes have none), and a composite FK defaults to
-- MATCH SIMPLE, which skips enforcement entirely when any column of the key is
-- NULL. Without the check, setting project_id while leaving client_id null
-- would slip straight past the foreign key.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_project_tenant') then
    alter table public.quotes
      add constraint quotes_project_tenant
        foreign key (project_id, client_id)
        references public.projects (id, client_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_project_needs_client') then
    alter table public.quotes
      add constraint quotes_project_needs_client
        check (project_id is null or client_id is not null);
  end if;
  -- An unknown service key would be a tab that never unlocks and never errors.
  if not exists (select 1 from pg_constraint where conname = 'quotes_services_known') then
    alter table public.quotes
      add constraint quotes_services_known
        check (services <@ array['renders','packaging_artwork','market_analytics']::text[]);
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────
-- Accepting the quote is the event
-- ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the ledger is staff-only and this may also run from
-- a background job or the service role; the authorization that matters already
-- happened, because only staff can update a quote at all (quotes carries a
-- permissive staff policy AND the restrictive gl tenant guard, with no customer
-- policy of any kind).
create or replace function public.gl_quote_grant_entitlements()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_key     text;
  v_todo    text[] := '{}';
  v_granted text[] := '{}';
  v_client  uuid;
  v_project text;
  v_actor   uuid;
begin
  -- Only the transition into 'accepted'. An edit to an already-accepted quote
  -- must not re-run this.
  if new.status is distinct from 'accepted' then return new; end if;
  if old.status is not distinct from 'accepted' then return new; end if;

  if new.project_id is null then return new; end if;
  if coalesce(array_length(new.services, 1), 0) = 0 then return new; end if;

  -- Archived project: nothing to unlock, because an archived project is gone
  -- from the portal entirely. Same rule the notification triggers use.
  select p.client_id, p.name into v_client, v_project
    from public.projects p
   where p.id = new.project_id and p.archived_at is null;
  if v_client is null then return new; end if;

  -- Work out what is actually missing BEFORE asking who is doing it, so a
  -- quote that re-grants nothing never trips the actor check below.
  foreach v_key in array new.services loop
    if coalesce((
         select e.action
           from public.project_entitlement_events e
          where e.project_id = new.project_id
            and e.service_key = v_key
          order by e.seq desc
          limit 1), '') is distinct from 'grant' then
      v_todo := v_todo || v_key;
    end if;
  end loop;

  if coalesce(array_length(v_todo, 1), 0) = 0 then return new; end if;

  -- project_entitlement_events.actor is NOT NULL and references profiles: phase
  -- 1 decided a grant must name who made it, because this is the billing
  -- record. auth.uid() is null for the service role, a background job or a
  -- migration, and there is no "system" profile to fall back to.
  --
  -- So this fails LOUDLY rather than granting anonymously or skipping silently.
  -- It is the rule phase 1 wrote down -- an unauditable change to an
  -- entitlement should not happen -- and it costs the real path nothing: staff
  -- accept quotes from a signed-in browser session, where auth.uid() is set.
  -- Caught by the rollback probe on first run, which is why it is here.
  v_actor := auth.uid();
  if v_actor is null then
    raise exception
      'Quote % cannot grant services: no signed-in user to record as the actor. Accept the quote from a staff session, or grant the service directly in project admin.',
      coalesce(nullif(new.quote_number, ''), '(unnumbered)')
      using errcode = '42501';
  end if;

  foreach v_key in array v_todo loop
    insert into public.project_entitlement_events
      (project_id, service_key, action, actor, note)
    values
      (new.project_id, v_key, 'grant', v_actor,
       'Granted by quote ' || coalesce(nullif(new.quote_number, ''), '(unnumbered)'));
    v_granted := v_granted || v_key;
  end loop;

  -- Only tell the client when something actually changed for them. A quote that
  -- re-grants nothing is an internal event and not worth an email.
  if array_length(v_granted, 1) > 0 then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'A new service is available on ' || v_project,
      'Hello,' || chr(10) || chr(10) ||
      'Your quote has been accepted, and the following is now open in your portal for '
        || v_project || ':' || chr(10) || chr(10) ||
      (select string_agg('  - ' || case s
                                     when 'renders'           then 'Product Renders'
                                     when 'packaging_artwork' then 'Packaging & Artwork'
                                     when 'market_analytics'  then 'Market Analytics'
                                     else s
                                   end, chr(10))
         from unnest(v_granted) s) ||
      chr(10) || chr(10) || 'You can see it here:' || chr(10) ||
      'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co');
  end if;

  return new;
end
$fn$;

revoke all on function public.gl_quote_grant_entitlements()
  from authenticated, public, anon;

drop trigger if exists trg_quote_grant_entitlements on public.quotes;
create trigger trg_quote_grant_entitlements
  after update on public.quotes
  for each row execute function public.gl_quote_grant_entitlements();

notify pgrst, 'reload schema';
