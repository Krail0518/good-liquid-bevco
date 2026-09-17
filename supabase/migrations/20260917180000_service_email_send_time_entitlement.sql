-- ════════════════════════════════════════════════════════════════
-- A "new service is open" email re-checks the service before sending (GL-122)
-- Independent review 2026-09-17, finding R4.
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   Re-run the gl_quote_grant_entitlements and gl_portal_email_block_reason
--   bodies from 20260917090100_portal_records_and_notifications.sql, then
--   notify pgrst, 'reload schema';
--   No table or row changes. Rows queued after this migration carry an extra
--   `services` key, which the old functions ignore.
--
-- WHAT WAS WRONG. The owner's decision (17 Sep) was that a queued email is
-- re-checked at send time and dropped if what it announces is no longer true.
-- For a service announcement the queue row stored only the project id, and the
-- send-time check treated `service` like `milestone`: project still active and
-- still this client's. It never looked at the entitlement ledger. So: accept a
-- quote (email queued: "Product Renders is now open"), revoke Renders before the
-- scheduler runs, and the email still went out claiming it was open.
--
-- THE FIX.
--   1. The announcement records WHICH services it announces:
--        portal_event = {kind:'service', ref:<project>, services:[...]}
--   2. At send time each of those services must still have `grant` as its
--      latest ledger event on that project. If ANY has been revoked the email
--      is skipped, not rewritten — its text says all of them are open, and a
--      partly false announcement is still false. The customer sees the true
--      state in the portal; a re-grant queues a fresh, accurate email.
--   3. A service row with no service list (queued before this migration) cannot
--      be verified, so it is skipped. Production has none pending: the one
--      service email ever queued was sent before this change.
-- Milestone announcements keep the project check they had.

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
  if v_client is null then return new; end if;

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
      -- GL-122: record exactly what the text announces, so the send-time
      -- check can verify each service is still open.
      jsonb_build_object('kind', 'service', 'ref', new.project_id,
                         'services', to_jsonb(v_granted)));
  end if;

  return new;
end
$function$;

revoke all on function public.gl_quote_grant_entitlements() from public, anon, authenticated;


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
  v_revoked text;
begin
  select * into e from public.email_schedule where id = p_schedule_id;
  if not found then return 'queue row not found'; end if;
  if e.portal_event is null then return null; end if;

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

    if v_kind = 'service' then
      -- GL-122: the email says these services are open. Every one must still be.
      if jsonb_typeof(e.portal_event->'services') is distinct from 'array'
         or jsonb_array_length(e.portal_event->'services') = 0 then
        return 'service announcement does not list its services, so it cannot be verified';
      end if;
      select string_agg(s.key, ', ' order by s.key) into v_revoked
        from jsonb_array_elements_text(e.portal_event->'services') as s(key)
       where coalesce((
               select ev.action from public.project_entitlement_events ev
                where ev.project_id = v_ref and ev.service_key = s.key
                order by ev.seq desc limit 1), '') is distinct from 'grant';
      if v_revoked is not null then
        return 'announced service no longer open: ' || v_revoked;
      end if;
    end if;
  end if;

  return null;
end
$function$;

revoke all on function public.gl_portal_email_block_reason(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
