-- ════════════════════════════════════════════════════════════════
-- Formula corrections without losing logged files, locked accepted quotes,
-- notifications that match portal visibility  (Codex CP03, CP07, CP08)
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK: restores the 20260916 behaviour:
--   drop trigger trg_formula_documents_supersede on public.formula_documents; drop function public.gl_guard_formula_document_supersede();
--   drop index public.formula_documents_current_kind_uniq;
--   alter table public.formula_documents add constraint formula_documents_kind_uniq unique (formula_id, version, doc_kind);
--     (fails if a superseded and a current row share a kind — resolve those first)
--   alter table public.formula_documents drop column superseded_at, drop column superseded_by;
--   drop trigger trg_quotes_accepted_lock on public.quotes; drop function public.gl_guard_accepted_quote();
--   restore gl_quote_grant_entitlements(), gl_notify_document(), gl_notify_artwork_decision(),
--     gl_notify_milestone(), gl_notify_run_stage() and gl_enqueue_portal_email(uuid,text,text,text)
--     from 20260915140000 / 20260916000000;
--   drop function public.gl_enqueue_portal_email(uuid,text,text,text,jsonb);
--   drop function public.gl_portal_email_block_reason(uuid);
--   alter table public.email_schedule drop column portal_event;
--   restore email_schedule_status_check to pending|sent|failed|cancelled
--     (only after no row is 'sending' or 'skipped');
--   notify pgrst, 'reload schema';
--
-- ── CP03. A correction to a downloaded document had nowhere to go ───────────
-- (formula_id, version, doc_kind) was unique, and a downloaded document cannot
-- be deleted (the access log is ON DELETE RESTRICT, and now storage refuses to
-- delete its file too — 20260917090000). So the only way to fix a wrong spec
-- sheet on v3 was to delete the one that had been read, which is exactly what
-- must never happen. A document can now be SUPERSEDED: it is unpublished, kept
-- with its file and access history, and no longer counts against the unique
-- kind, so the corrected file is attached beside it. A superseded document can
-- never be published again.
--
-- ── CP07. Services added to an accepted quote were never granted ────────────
-- The grant trigger fires only on the transition INTO accepted, but the staff
-- editor let services and project change afterwards and said "services
-- unlocked". Owner decision 2026-09-17: an accepted quote is locked. Its project,
-- services and status can no longer change; more services go on a new quote,
-- which grants on its own acceptance. Nothing is revoked automatically — grants
-- from other quotes or from project admin are untouched. Accepting a quote on
-- an archived project with services is now refused with a reason instead of
-- silently granting nothing.
--
-- ── CP08. Email announced documents the client could not open ───────────────
-- The document trigger had no archived-project check, and the artwork trigger
-- checked the artwork's own flag but not its project's. Both now use the same
-- visibility rule as the portal. And because access can change between queueing
-- and sending (owner decision 2026-09-17), every portal email now carries the
-- event it announces; the scheduler asks gl_portal_email_block_reason() just
-- before sending and marks the row 'skipped' with the reason if the recipient is
-- no longer active or opted in, or the thing announced is no longer visible.
--
-- A deeper defect found on the way: email_schedule_status_check never admitted
-- 'sending', the status the scheduler claims a row with. Every claim failed, so
-- NO scheduled email has ever been sent — the one portal email in the queue
-- (16 Sep, QA project) has zero attempts. 'sending' and 'skipped' are added.
-- ════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------- CP03

alter table public.formula_documents
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid references public.profiles(id);

alter table public.formula_documents drop constraint if exists formula_documents_kind_uniq;
create unique index if not exists formula_documents_current_kind_uniq
  on public.formula_documents (formula_id, version, doc_kind)
  where superseded_at is null;

create or replace function public.gl_guard_formula_document_supersede()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.superseded_at is not null then
    if new.superseded_at is null then
      raise exception 'a superseded formula document stays superseded' using errcode = '42501';
    end if;
    if new.published_at is not null then
      raise exception 'a superseded formula document cannot be published; publish its replacement'
        using errcode = '42501';
    end if;
    if new.file_path is distinct from old.file_path then
      raise exception 'a superseded formula document keeps its file' using errcode = '42501';
    end if;
  end if;

  if new.superseded_at is not null and old.superseded_at is null then
    if auth.uid() is null then
      raise exception 'superseding a formula document needs a signed-in staff member' using errcode = '42501';
    end if;
    new.superseded_at := now();
    new.superseded_by := auth.uid();
    new.published_at  := null;
    new.published_by  := null;
  end if;

  -- The file behind a document that has been downloaded is part of the record.
  if new.file_path is distinct from old.file_path
     and exists (select 1 from public.formula_document_downloads d where d.formula_document_id = old.id) then
    raise exception 'formula document % has been downloaded; its file cannot be replaced — supersede it and attach the correction',
      old.id using errcode = '42501';
  end if;

  return new;
end
$$;
revoke all on function public.gl_guard_formula_document_supersede() from public, anon, authenticated;

drop trigger if exists trg_formula_documents_supersede on public.formula_documents;
create trigger trg_formula_documents_supersede
  before update on public.formula_documents
  for each row execute function public.gl_guard_formula_document_supersede();

-- ---------------------------------------------------------------- CP07

create or replace function public.gl_guard_accepted_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.status = 'accepted' then
    if new.status is distinct from old.status then
      raise exception 'quote % is accepted and stays accepted; create a new quote instead',
        coalesce(nullif(old.quote_number,''),'(unnumbered)') using errcode = '42501';
    end if;
    if new.services is distinct from old.services or new.project_id is distinct from old.project_id then
      raise exception 'quote % is accepted, so its project and services are locked; put additional services on a new quote',
        coalesce(nullif(old.quote_number,''),'(unnumbered)') using errcode = '42501';
    end if;
  end if;

  if new.status = 'accepted' and old.status is distinct from 'accepted'
     and coalesce(array_length(new.services, 1), 0) > 0 then
    if new.project_id is null then
      raise exception 'quote % sells portal services but has no project; pick the project before accepting',
        coalesce(nullif(new.quote_number,''),'(unnumbered)') using errcode = '23514';
    end if;
    if exists (select 1 from public.projects p where p.id = new.project_id and p.archived_at is not null) then
      raise exception 'quote % is for an archived project; restore the project before accepting',
        coalesce(nullif(new.quote_number,''),'(unnumbered)') using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;
revoke all on function public.gl_guard_accepted_quote() from public, anon, authenticated;

drop trigger if exists trg_quotes_accepted_lock on public.quotes;
create trigger trg_quotes_accepted_lock
  before update on public.quotes
  for each row execute function public.gl_guard_accepted_quote();

-- ---------------------------------------------------------------- CP08: queue

alter table public.email_schedule drop constraint if exists email_schedule_status_check;
alter table public.email_schedule add constraint email_schedule_status_check
  check (status = any (array['pending','sending','sent','failed','cancelled','skipped']));

alter table public.email_schedule add column if not exists portal_event jsonb;

drop function if exists public.gl_enqueue_portal_email(uuid, text, text, text);
create or replace function public.gl_enqueue_portal_email(
  p_client_id uuid, p_pref text, p_subject text, p_body text, p_event jsonb default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_count int := 0;
  r record;
  v_event jsonb;
begin
  if p_client_id is null or coalesce(p_subject,'') = '' then return 0; end if;
  if p_pref not in ('project','run_stage') then return 0; end if;

  -- What the email announces, re-checked by the scheduler just before sending.
  v_event := coalesce(p_event, '{}'::jsonb)
             || jsonb_build_object('client_id', p_client_id, 'pref', p_pref);

  for r in
    select cu.email
      from public.customer_users cu
     where cu.client_id = p_client_id
       and cu.active = true
       and coalesce(nullif(cu.email,''), null) is not null
       and case p_pref
             when 'project'   then cu.notify_project_updates
             when 'run_stage' then cu.notify_run_stage_changes
           end is true
  loop
    if not exists (
      select 1 from public.email_schedule e
       where e.to_email = r.email
         and e.subject = p_subject
         and e.status in ('pending','sending')
         and e.created_at > now() - interval '1 hour'
    ) then
      insert into public.email_schedule (to_email, subject, body, send_at, status, portal_event)
      values (r.email, p_subject, p_body, now(), 'pending', v_event);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end
$function$;
revoke all on function public.gl_enqueue_portal_email(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Null means "still fine to send". Otherwise, the reason it must not go.
create or replace function public.gl_portal_email_block_reason(p_schedule_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  e public.email_schedule%rowtype;
  v_client uuid; v_pref text; v_kind text; v_ref uuid;
begin
  select * into e from public.email_schedule where id = p_schedule_id;
  if not found then return 'queue row not found'; end if;
  if e.portal_event is null then return null; end if;   -- not a portal email

  v_client := nullif(e.portal_event->>'client_id','')::uuid;
  v_pref   := e.portal_event->>'pref';
  v_kind   := e.portal_event->>'kind';
  v_ref    := nullif(e.portal_event->>'ref','')::uuid;

  if not exists (
    select 1 from public.customer_users cu
     where lower(cu.email) = lower(e.to_email)
       and cu.client_id = v_client
       and cu.active = true
       and case v_pref when 'project' then cu.notify_project_updates
                       when 'run_stage' then cu.notify_run_stage_changes end is true
  ) then
    return 'recipient is no longer an active portal user with this notification switched on';
  end if;

  if v_kind = 'document' then
    if not exists (
      select 1 from public.deal_documents d
       where d.id = v_ref and d.client_id = v_client and d.client_visible = true
         and (d.project_id is null or exists (
               select 1 from public.projects p where p.id = d.project_id and p.archived_at is null))
    ) then return 'document is no longer visible to the client'; end if;

  elsif v_kind = 'artwork' then
    if not exists (
      select 1 from public.client_artwork a
       where a.id = v_ref and a.client_id = v_client and a.archived_at is null
         and (a.project_id is null or exists (
               select 1 from public.projects p where p.id = a.project_id and p.archived_at is null))
    ) then return 'artwork is no longer visible to the client'; end if;

  elsif v_kind in ('milestone','service') then
    if not exists (
      select 1 from public.projects p where p.id = v_ref and p.client_id = v_client and p.archived_at is null
    ) then return 'project is archived or no longer this client''s'; end if;
  end if;

  return null;
end
$function$;
revoke all on function public.gl_portal_email_block_reason(uuid) from public, anon, authenticated;
grant execute on function public.gl_portal_email_block_reason(uuid) to service_role;

-- ---------------------------------------------------------------- CP08: triggers

create or replace function public.gl_notify_document()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if new.client_visible = true and old.client_visible is distinct from true
     and new.client_id is not null
     -- The same rule the portal and storage apply: a document on an archived
     -- project is not visible, so it is not announced.
     and (new.project_id is null or exists (
           select 1 from public.projects p
            where p.id = new.project_id and p.client_id = new.client_id and p.archived_at is null)) then
    perform public.gl_enqueue_portal_email(
      new.client_id, 'project',
      'A new document is available',
      'Hello,' || chr(10) || chr(10) ||
      'We have added a document to your account: ' || new.name ||
      case when coalesce(new.doc_type,'') <> '' then ' (' || new.doc_type || ')' else '' end || '.' ||
      chr(10) || chr(10) || 'You can view and download it here:' || chr(10) ||
      'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co',
      jsonb_build_object('kind', 'document', 'ref', new.id));
  end if;
  return new;
end
$function$;

create or replace function public.gl_notify_artwork_decision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_client uuid; v_sku text;
begin
  if new.decision not in ('approved','changes_requested') then return new; end if;

  select a.client_id, a.sku_name into v_client, v_sku
    from public.client_artwork a
   where a.id = new.artwork_id
     and a.archived_at is null
     and (a.project_id is null or exists (
           select 1 from public.projects p where p.id = a.project_id and p.archived_at is null));
  if v_client is null then return new; end if;

  if new.decision = 'approved' then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Artwork approved: ' || v_sku,
      'Hello,' || chr(10) || chr(10) ||
      'Your artwork for ' || v_sku || ' is approved.' ||
      case when coalesce(new.client_note,'') <> '' then chr(10) || chr(10) || new.client_note else '' end ||
      chr(10) || chr(10) || 'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co',
      jsonb_build_object('kind', 'artwork', 'ref', new.artwork_id));
  else
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Changes requested: ' || v_sku,
      'Hello,' || chr(10) || chr(10) ||
      'We have asked for changes to the artwork for ' || v_sku || '.' ||
      case when coalesce(new.client_note,'') <> '' then chr(10) || chr(10) || new.client_note else '' end ||
      chr(10) || chr(10) || 'Upload the revised artwork in your portal:' || chr(10) ||
      'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co',
      jsonb_build_object('kind', 'artwork', 'ref', new.artwork_id));
  end if;

  return new;
end
$function$;

create or replace function public.gl_notify_milestone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_client uuid; v_project text; v_link text := 'https://goodliquidbevco.com/?portal=1';
begin
  select p.client_id, p.name into v_client, v_project
    from public.projects p
   where p.id = new.project_id and p.archived_at is null;
  if v_client is null then return new; end if;

  if new.status = 'awaiting_client' and old.status is distinct from 'awaiting_client' then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Action needed: ' || v_project,
      'Hello,' || chr(10) || chr(10) ||
      'We need something from you on ' || v_project || ' to keep moving: ' || new.label ||
      case when new.round > 1 then ' (round ' || new.round || ')' else '' end || '.' ||
      case when coalesce(new.client_note,'') <> '' then chr(10) || chr(10) || new.client_note else '' end ||
      case when new.target_date is not null then chr(10) || chr(10) || 'Target date: ' || new.target_date else '' end ||
      chr(10) || chr(10) || 'You can see where the project stands here:' || chr(10) || v_link ||
      chr(10) || chr(10) || 'Good Liquid Bev Co',
      jsonb_build_object('kind', 'milestone', 'ref', new.project_id));
  elsif coalesce(new.client_note,'') <> '' and new.client_note is distinct from old.client_note then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Update on ' || v_project,
      'Hello,' || chr(10) || chr(10) ||
      'There is an update on ' || v_project || ' — ' || new.label || ':' || chr(10) || chr(10) ||
      new.client_note ||
      chr(10) || chr(10) || 'The full picture is in your portal:' || chr(10) || v_link ||
      chr(10) || chr(10) || 'Good Liquid Bev Co',
      jsonb_build_object('kind', 'milestone', 'ref', new.project_id));
  end if;

  return new;
end
$function$;

create or replace function public.gl_notify_run_stage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_client uuid;
begin
  if new.stage is not distinct from old.stage then return new; end if;
  begin
    v_client := new.client_id::uuid;
  exception when others then
    return new;
  end;
  if v_client is null then return new; end if;

  perform public.gl_enqueue_portal_email(
    v_client, 'run_stage',
    'Production update: ' || coalesce(new.run_name, 'your run'),
    'Hello,' || chr(10) || chr(10) ||
    coalesce(new.run_name, 'Your run') || ' has moved to ' || new.stage || '.' ||
    case when coalesce(new.lot_number,'') <> '' then chr(10) || 'Lot: ' || new.lot_number else '' end ||
    chr(10) || chr(10) || 'Track it in your portal:' || chr(10) ||
    'https://goodliquidbevco.com/?portal=1' ||
    chr(10) || chr(10) || 'Good Liquid Bev Co' ||
    chr(10) || chr(10) ||
    'To stop these, untick "Production stage emails" in your portal account settings.',
    jsonb_build_object('kind', 'run_stage', 'ref', new.id));

  return new;
end
$function$;

create or replace function public.gl_quote_grant_entitlements()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_key     text;
  v_todo    text[] := '{}';
  v_granted text[] := '{}';
  v_client  uuid;
  v_project text;
  v_actor   uuid;
begin
  if new.status is distinct from 'accepted' then return new; end if;
  if old.status is not distinct from 'accepted' then return new; end if;

  if new.project_id is null then return new; end if;
  if coalesce(array_length(new.services, 1), 0) = 0 then return new; end if;

  select p.client_id, p.name into v_client, v_project
    from public.projects p
   where p.id = new.project_id and p.archived_at is null;
  if v_client is null then return new; end if;   -- gl_guard_accepted_quote refuses this case first

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
      chr(10) || chr(10) || 'Good Liquid Bev Co',
      jsonb_build_object('kind', 'service', 'ref', new.project_id));
  end if;

  return new;
end
$function$;

-- The one portal email already in the queue predates portal_event. It announces
-- a service on the QA project; tag it so it is re-checked like any other.
update public.email_schedule
   set portal_event = jsonb_build_object('kind','service','ref','6545773f-06e7-412b-a944-f9e1384b5556',
                                         'client_id','3b666344-a346-4761-a3b0-8cf97f022e2b','pref','project')
 where id = 'aaa74803-a58f-4e4e-9611-ee188218d936' and portal_event is null;

notify pgrst, 'reload schema';
