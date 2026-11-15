-- ════════════════════════════════════════════════════════════════
-- Project tracker — Good Liquid's real step list, and steps that move themselves
-- ════════════════════════════════════════════════════════════════
-- The milestone template from 20260914090000 described a generic "sample ->
-- feedback -> PA letter -> production ready" track. Good Liquid's actual flow is:
--
--   Onboarding -> Formulation -> 1 L batch (feedback / revision rounds)
--   -> 1 L batch approved -> 50 L batch -> Process Authority letter
--   -> Production scheduled -> Production run -> Quality check and shipped
--   -> Invoiced and paid
--
-- This migration:
--   1. replaces the template stamped on every new project;
--   2. moves the existing projects onto the new keys, keeping finished steps
--      and their completed_at (internal_testing / sample_prep fold into
--      Formulation; "complete" is the project's own status, not a step);
--   3. adds AUTO-ADVANCE: a finished step starts the next one, and CRM events
--      finish steps by themselves (onboarding submitted, Process Authority
--      letter uploaded, production run scheduled / shipped, invoice paid).
--
-- SECURITY. No new table, no new policy, no new grant. Every function here is
-- SECURITY DEFINER, called only from triggers, and EXECUTE is revoked from
-- public, anon and authenticated. A portal customer still reads milestones
-- through "project_milestones customer read" (own client, unarchived project)
-- and cannot write them at all — nothing here changes that. The sales steps
-- (lead, qualified, quote, won) are NOT milestones: they are derived on the
-- staff page from deals / quotes, which are staff-only, so a client can never
-- see their own pipeline notes or anyone else's.
--
-- Auto moves are FORWARD ONLY: they complete open steps and start
-- not-started ones, and never touch a step staff marked completed or skipped.
-- Every move is audited by gl_audit_milestone, which now records which event
-- caused it (details.auto_source), so the history says "auto: invoice paid"
-- rather than an unexplained change.
--
-- ROLLBACK:
--   drop trigger if exists trg_ms_advance          on public.project_milestones;
--   drop trigger if exists trg_ms_from_onboarding  on public.onboarding;
--   drop trigger if exists trg_ms_from_document    on public.deal_documents;
--   drop trigger if exists trg_ms_from_run         on public.production_runs;
--   drop trigger if exists trg_ms_from_invoice     on public.invoices;
--   drop function if exists public.gl_ms_advance();
--   drop function if exists public.gl_ms_from_onboarding();
--   drop function if exists public.gl_ms_from_document();
--   drop function if exists public.gl_ms_from_run();
--   drop function if exists public.gl_ms_from_invoice();
--   drop function if exists public.gl_ms_set(uuid, text, text, text);
--   drop function if exists public.gl_ms_project_for(uuid, text);
--   Then re-run the gl_stamp_project_milestones and gl_audit_milestone bodies
--   from 20260914090000_projects_and_milestones.sql. Renamed milestone rows
--   keep their new keys (batch_1l_sent etc.); the old generic labels are not
--   restored. Rows deleted in step 2 are recorded in audit_log
--   (action 'milestone_retired') with their full content.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- Audit: record what caused an automatic move
-- ────────────────────────────────────────────────────────────────
create or replace function public.gl_audit_milestone()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_source text := case when auth.uid() is null then 'system' else 'user' end;
  v_auto   text := nullif(current_setting('gl.ms_source', true), '');
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            'milestone_status_changed', new.id::text,
            jsonb_build_object('source', case when v_auto is not null then 'auto' else v_source end,
                               'auto_source', v_auto,
                               'db_role', current_user,
                               'project_id', new.project_id, 'track', new.track,
                               'key', new.key, 'label', new.label, 'round', new.round,
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

revoke all on function public.gl_audit_milestone() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- New-project template
-- ────────────────────────────────────────────────────────────────
-- Onboarding is a client-level fact, so a project created for a client who
-- already submitted onboarding starts with that step done and Formulation
-- under way, instead of showing a finished client as "Onboarding: not started".
create or replace function public.gl_stamp_project_milestones()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_onboarded boolean := exists (
    select 1 from public.onboarding o
     where o.client_id = new.client_id
       and (o.status = 'submitted' or o.submitted_at is not null));
begin
  insert into public.project_milestones
    (project_id, track, key, label, sort_order, owner, status, completed_at)
  values
    (new.id, 'formulation', 'intake',               'Onboarding',                 1,  'client',
       case when v_onboarded then 'completed' else 'awaiting_client' end,
       case when v_onboarded then now() end),
    (new.id, 'formulation', 'formulation',          'Formulation',                2,  'gl',
       case when v_onboarded then 'in_progress' else 'not_started' end, null),
    (new.id, 'formulation', 'batch_1l_sent',        '1 L batch sent',             3,  'gl',     'not_started', null),
    (new.id, 'formulation', 'client_feedback',      'Your feedback',              4,  'client', 'not_started', null),
    (new.id, 'formulation', 'formula_revisions',    'Formula revisions',          5,  'gl',     'not_started', null),
    (new.id, 'formulation', 'batch_1l_approved',    '1 L batch approved',         6,  'client', 'not_started', null),
    (new.id, 'formulation', 'batch_50l',            '50 L batch',                 7,  'gl',     'not_started', null),
    (new.id, 'formulation', 'pa_letter',            'Process Authority letter',   8,  'gl',     'not_started', null),
    (new.id, 'formulation', 'production_scheduled', 'Production scheduled',       9,  'gl',     'not_started', null),
    (new.id, 'formulation', 'production_run',       'Production run',             10, 'gl',     'not_started', null),
    (new.id, 'formulation', 'shipped',              'Quality check and shipped',  11, 'gl',     'not_started', null),
    (new.id, 'formulation', 'invoiced_paid',        'Invoiced and paid',          12, 'gl'    , 'not_started', null),
    (new.id, 'artwork',     'packaging_artwork',    'Packaging and artwork',      1,  'gl',     'not_started', null);
  return new;
end
$fn$;

revoke all on function public.gl_stamp_project_milestones() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- gl_ms_set — the single forward-only write path for automatic moves
-- ────────────────────────────────────────────────────────────────
-- Acts on the LATEST round of a key only. 'completed' finishes any open step;
-- 'in_progress' / 'awaiting_client' only start a step that has not started.
-- Never touches a completed or skipped step: staff overrides always win.
create or replace function public.gl_ms_set(p_project uuid, p_key text, p_status text, p_source text)
returns int
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_prev text := current_setting('gl.ms_source', true);
  v_n    int;
begin
  if p_project is null then return 0; end if;
  if not exists (select 1 from public.projects p
                  where p.id = p_project and p.archived_at is null
                    and p.status in ('active','on_hold')) then
    return 0;
  end if;

  perform set_config('gl.ms_source', p_source, true);

  update public.project_milestones m
     set status = p_status,
         completed_at = case when p_status = 'completed' then coalesce(m.completed_at, now())
                             else m.completed_at end
   where m.project_id = p_project
     and m.track = 'formulation'
     and m.key = p_key
     and m.round = (select max(x.round) from public.project_milestones x
                     where x.project_id = p_project and x.track = 'formulation' and x.key = p_key)
     and (   (p_status = 'completed' and m.status not in ('completed','skipped'))
          or (p_status in ('in_progress','awaiting_client') and m.status = 'not_started'));
  get diagnostics v_n = row_count;

  perform set_config('gl.ms_source', coalesce(v_prev, ''), true);
  return v_n;
end
$fn$;

revoke all on function public.gl_ms_set(uuid, text, text, text) from public, anon, authenticated;

-- Which project a client-level event belongs to. One live project: that one.
-- Several: the one whose product_name matches; otherwise none — guessing
-- would advance the wrong product, and staff can always click the step.
create or replace function public.gl_ms_project_for(p_client uuid, p_product text)
returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  with live as (
    select p.id, p.product_name, p.name
      from public.projects p
     where p.client_id = p_client and p.archived_at is null
       and p.status in ('active','on_hold'))
  select case
    when (select count(*) from live) = 1 then (select id from live)
    else (select id from live
           where coalesce(p_product, '') <> ''
             and (lower(product_name) = lower(p_product) or lower(name) = lower(p_product))
           limit 1)
  end;
$fn$;

revoke all on function public.gl_ms_project_for(uuid, text) from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- Advance: a finished step starts the next one
-- ────────────────────────────────────────────────────────────────
-- Two special cases, both about the 1 L loop (sent -> feedback -> revisions):
--   * Revisions finished and the 1 L batch is not approved yet: the loop goes
--     round again (new round rows), it does not jump to "approved".
--   * 1 L batch approved: open loop steps close (feedback done, the rest
--     skipped) and the loop is never picked as "next" again.
create or replace function public.gl_ms_advance()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_prev     text := current_setting('gl.ms_source', true);
  v_approved boolean;
  v_next     record;
begin
  if new.track <> 'formulation' or new.status <> 'completed'
     or old.status = 'completed' then
    return new;
  end if;
  -- Closing the 1 L loop below completes "Your feedback"; that housekeeping
  -- must not advance anything by itself, or approval would start two steps.
  if current_setting('gl.ms_no_advance', true) = '1' then
    return new;
  end if;

  perform set_config('gl.ms_source',
                     coalesce(nullif(v_prev, ''), 'auto') || ' -> after ' || new.label, true);

  v_approved := exists (select 1 from public.project_milestones a
                         where a.project_id = new.project_id and a.track = 'formulation'
                           and a.key = 'batch_1l_approved' and a.status = 'completed');

  if new.key = 'formula_revisions' and not v_approved then
    insert into public.project_milestones
      (project_id, track, key, label, sort_order, owner, round, status)
    select new.project_id, 'formulation', t.key, t.label, t.sort_order, t.owner, new.round + 1,
           case when t.key = 'batch_1l_sent' then 'in_progress' else 'not_started' end
      from public.project_milestones t
     where t.project_id = new.project_id and t.track = 'formulation'
       and t.key in ('batch_1l_sent','client_feedback','formula_revisions')
       and t.round = new.round
    on conflict (project_id, track, key, round) do nothing;
    perform set_config('gl.ms_source', coalesce(v_prev, ''), true);
    return new;
  end if;

  if new.key = 'batch_1l_approved' then
    perform set_config('gl.ms_no_advance', '1', true);
    update public.project_milestones l
       -- Feedback the client was actually asked for is answered by the
       -- approval; a round nobody started is just skipped.
       set status = case when l.key = 'client_feedback' and l.status in ('awaiting_client','in_progress')
                         then 'completed' else 'skipped' end,
           completed_at = case when l.key = 'client_feedback' and l.status in ('awaiting_client','in_progress')
                               then coalesce(l.completed_at, now()) else l.completed_at end
     where l.project_id = new.project_id and l.track = 'formulation'
       and l.key in ('batch_1l_sent','client_feedback','formula_revisions')
       and l.status not in ('completed','skipped');
    perform set_config('gl.ms_no_advance', '', true);
  end if;

  -- The step IMMEDIATELY after this one (skipped steps passed over). Started
  -- only if it has not started; if it is already under way or done, nothing
  -- moves — an advance must never jump two steps ahead.
  select m.id, m.owner, m.status into v_next
    from public.project_milestones m
   where m.project_id = new.project_id and m.track = 'formulation'
     and m.sort_order > new.sort_order
     and m.status <> 'skipped'
     and m.round = (select max(x.round) from public.project_milestones x
                     where x.project_id = m.project_id and x.track = m.track and x.key = m.key)
     and not ((v_approved or new.key = 'batch_1l_approved')
              and m.key in ('batch_1l_sent','client_feedback','formula_revisions'))
   order by m.sort_order
   limit 1;

  if v_next.id is not null and v_next.status = 'not_started' then
    update public.project_milestones
       set status = case when v_next.owner = 'client' then 'awaiting_client' else 'in_progress' end
     where id = v_next.id and status = 'not_started';
  end if;

  perform set_config('gl.ms_source', coalesce(v_prev, ''), true);
  return new;
end
$fn$;

revoke all on function public.gl_ms_advance() from public, anon, authenticated;

drop trigger if exists trg_ms_advance on public.project_milestones;
create trigger trg_ms_advance
  after update of status on public.project_milestones
  for each row execute function public.gl_ms_advance();

-- ────────────────────────────────────────────────────────────────
-- CRM events that finish steps
-- ────────────────────────────────────────────────────────────────

-- Onboarding form submitted -> Onboarding done on every live project.
create or replace function public.gl_ms_from_onboarding()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare r record;
begin
  if new.client_id is null then return new; end if;
  if not (new.status = 'submitted' or new.submitted_at is not null) then return new; end if;
  if tg_op = 'UPDATE' and (old.status = 'submitted' or old.submitted_at is not null)
     and old.client_id is not distinct from new.client_id then
    return new;
  end if;
  for r in select p.id from public.projects p
            where p.client_id = new.client_id and p.archived_at is null loop
    perform public.gl_ms_set(r.id, 'intake', 'completed', 'auto: onboarding form submitted');
  end loop;
  return new;
end
$fn$;

revoke all on function public.gl_ms_from_onboarding() from public, anon, authenticated;

drop trigger if exists trg_ms_from_onboarding on public.onboarding;
create trigger trg_ms_from_onboarding
  after insert or update of status, submitted_at, client_id on public.onboarding
  for each row execute function public.gl_ms_from_onboarding();

-- Process Authority letter uploaded -> that step done.
create or replace function public.gl_ms_from_document()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare v_project uuid;
begin
  if coalesce(new.doc_type, '') !~* '^process authority' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.doc_type, '') ~* '^process authority'
     and old.project_id is not distinct from new.project_id then
    return new;
  end if;
  v_project := coalesce(new.project_id, public.gl_ms_project_for(new.client_id, null));
  perform public.gl_ms_set(v_project, 'pa_letter', 'completed',
                           'auto: Process Authority letter uploaded');
  return new;
end
$fn$;

revoke all on function public.gl_ms_from_document() from public, anon, authenticated;

drop trigger if exists trg_ms_from_document on public.deal_documents;
create trigger trg_ms_from_document
  after insert or update of doc_type, project_id on public.deal_documents
  for each row execute function public.gl_ms_from_document();

-- Production run reaches Production -> scheduled; reaches Ship -> run done.
create or replace function public.gl_ms_from_run()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare v_project uuid;
begin
  -- production_runs.client_id is TEXT, not uuid. A value that is not a uuid
  -- must never make saving a run fail, so it is checked, never blindly cast.
  if new.client_id is null or new.client_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or new.stage not in ('Production','Ship') then return new; end if;
  if tg_op = 'UPDATE' and old.stage is not distinct from new.stage then return new; end if;
  v_project := public.gl_ms_project_for(new.client_id::text::uuid, new.product);
  if v_project is null then return new; end if;
  perform public.gl_ms_set(v_project, 'production_scheduled', 'completed',
                           'auto: production run ' || coalesce(new.run_name, '') || ' scheduled');
  if new.stage = 'Ship' then
    perform public.gl_ms_set(v_project, 'production_run', 'completed',
                             'auto: production run ' || coalesce(new.run_name, '') || ' moved to Ship');
  end if;
  return new;
end
$fn$;

revoke all on function public.gl_ms_from_run() from public, anon, authenticated;

drop trigger if exists trg_ms_from_run on public.production_runs;
create trigger trg_ms_from_run
  after insert or update of stage on public.production_runs
  for each row execute function public.gl_ms_from_run();

-- Invoice paid, on a project that has already shipped -> Invoiced and paid.
-- A deposit or formulation invoice paid earlier in the project must not mark
-- the project paid off, hence the "shipped" condition.
create or replace function public.gl_ms_from_invoice()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare r record;
begin
  if new.client_id is null or new.status <> 'paid'
     or old.status is not distinct from 'paid' then
    return new;
  end if;
  for r in select p.id from public.projects p
            where p.client_id = new.client_id and p.archived_at is null
              and exists (select 1 from public.project_milestones s
                           where s.project_id = p.id and s.key = 'shipped'
                             and s.status = 'completed') loop
    perform public.gl_ms_set(r.id, 'invoiced_paid', 'completed',
                             'auto: invoice ' || coalesce(new.invoice_number, '') || ' paid');
  end loop;
  return new;
end
$fn$;

revoke all on function public.gl_ms_from_invoice() from public, anon, authenticated;

drop trigger if exists trg_ms_from_invoice on public.invoices;
create trigger trg_ms_from_invoice
  after update of status on public.invoices
  for each row execute function public.gl_ms_from_invoice();

-- ────────────────────────────────────────────────────────────────
-- Move existing projects onto the new steps
-- ────────────────────────────────────────────────────────────────
-- Renames keep status, completed_at, client_note and round history. No row
-- moves INTO awaiting_client here, so gl_notify_milestone sends no email.
do $mv$
declare r record;
begin
  perform set_config('gl.ms_source', 'migration: project tracker steps', true);

  -- Record, then retire, steps that no longer exist in the flow.
  insert into public.audit_log (actor_id, actor_email, action, target, details)
  select null, 'migration', 'milestone_retired', m.id::text, to_jsonb(m)
    from public.project_milestones m
   where m.track = 'formulation'
     and m.key in ('internal_testing','sample_prep','complete','awaiting_pa_letter');

  for r in select distinct project_id from public.project_milestones
            where track = 'formulation' and key = 'awaiting_pa_letter' loop
    -- PA letter: the two old steps become one. Under way if either was.
    update public.project_milestones o
       set status = 'in_progress'
     where o.project_id = r.project_id and o.key = 'pa_letter_obtained'
       and o.status = 'not_started'
       and exists (select 1 from public.project_milestones a
                    where a.project_id = r.project_id and a.key = 'awaiting_pa_letter'
                      and a.status in ('in_progress','completed','awaiting_client'));
  end loop;

  delete from public.project_milestones
   where track = 'formulation'
     and key in ('internal_testing','sample_prep','complete','awaiting_pa_letter');

  update public.project_milestones set label = 'Onboarding', sort_order = 1, owner = 'client'
   where track = 'formulation' and key = 'intake';
  update public.project_milestones set sort_order = 2
   where track = 'formulation' and key = 'formulation';
  update public.project_milestones set key = 'batch_1l_sent', label = '1 L batch sent', sort_order = 3
   where track = 'formulation' and key = 'sample_sent';
  update public.project_milestones set sort_order = 4
   where track = 'formulation' and key = 'client_feedback';
  update public.project_milestones set sort_order = 5
   where track = 'formulation' and key = 'formula_revisions';
  update public.project_milestones set key = 'batch_1l_approved', label = '1 L batch approved', sort_order = 6
   where track = 'formulation' and key = 'formula_approved';
  update public.project_milestones set key = 'pa_letter', label = 'Process Authority letter', sort_order = 8
   where track = 'formulation' and key = 'pa_letter_obtained';
  update public.project_milestones set key = 'production_scheduled', label = 'Production scheduled', sort_order = 9
   where track = 'formulation' and key = 'production_ready';

  insert into public.project_milestones (project_id, track, key, label, sort_order, owner)
  select p.id, 'formulation', t.key, t.label, t.sort_order, t.owner
    from public.projects p
   cross join (values
     ('batch_50l',      '50 L batch',                7,  'gl'),
     ('production_run', 'Production run',            10, 'gl'),
     ('shipped',        'Quality check and shipped', 11, 'gl'),
     ('invoiced_paid',  'Invoiced and paid',         12, 'gl')
   ) as t(key, label, sort_order, owner)
   where exists (select 1 from public.project_milestones m where m.project_id = p.id)
  on conflict (project_id, track, key, round) do nothing;

  perform set_config('gl.ms_source', '', true);
end
$mv$;

notify pgrst, 'reload schema';
