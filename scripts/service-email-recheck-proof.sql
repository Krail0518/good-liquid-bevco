-- Service announcement send-time check — live behavioural proof (GL-122, review R4).
--
-- Accept a quote, which grants services and queues "now open" emails; then
-- revoke a service before the scheduler runs, and check what the scheduler's
-- send-time gate (gl_portal_email_block_reason, called by email-scheduler just
-- before each send) says. Nothing is sent: this never invokes the scheduler,
-- and everything is rolled back.
--
--   supabase db query --linked -f scripts/service-email-recheck-proof.sql

begin;

create temporary table proof(seq serial, assertion text, observed text, verdict text);

do $proof$
declare
  v_staff uuid; v_cust uuid; v_client uuid; v_cu uuid;
  v_proj uuid; v_q uuid; v_row uuid; v_legacy uuid; v_ms uuid;
  v_reason text; n int;
begin
  select p.id into v_staff from public.profiles p where coalesce(p.status,'active') <> 'inactive' and p.role = 'admin' limit 1;
  select cu.auth_user_id, cu.client_id, cu.id into v_cust, v_client, v_cu
    from public.customer_users cu join public.clients c on c.id = cu.client_id
   where cu.active and cu.auth_user_id is not null and coalesce(cu.email,'') <> ''
   order by (c.name ilike 'ZZ Portal QA%') desc limit 1;
  if v_staff is null or v_cust is null then
    insert into proof(assertion, observed, verdict) values ('fixtures present', 'missing staff or portal user', 'INCOMPLETE');
    return;
  end if;

  update public.customer_users set notify_project_updates = true where id = v_cu;
  insert into public.projects (client_id, name) values (v_client, 'zz service email proof') returning id into v_proj;
  insert into public.quotes (client_id, quote_number, quote_date, valid_days, product_type, package_format, status, tiers, addons, inclusions, project_id, services)
  values (v_client, 'ZZ-PROOF-R4', current_date, 30, 'canning', 'proof', 'draft', '[]', '[]', '{}', v_proj, array['renders','market_analytics'])
  returning id into v_q;

  -- Accept as staff: grants both services and queues the announcement.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.quotes set status = 'accepted' where id = v_q;
  reset role;

  select e.id into v_row from public.email_schedule e
   where e.portal_event->>'kind' = 'service' and e.portal_event->>'ref' = v_proj::text and e.status = 'pending'
   order by e.created_at desc limit 1;
  insert into proof(assertion, observed, verdict)
  select 'the announcement records exactly the services its text announces',
         coalesce((select (portal_event->'services')::text from public.email_schedule where id = v_row), 'no queued row'),
         case when (select portal_event->'services' from public.email_schedule where id = v_row)
                   @> '["renders","market_analytics"]'::jsonb
               and jsonb_array_length((select portal_event->'services' from public.email_schedule where id = v_row)) = 2
              then 'PASS' else 'FAIL' end;

  v_reason := public.gl_portal_email_block_reason(v_row);
  insert into proof(assertion, observed, verdict) values
    ('positive: while both services are granted the email may send', coalesce(v_reason, 'no block'),
     case when v_row is not null and v_reason is null then 'PASS' else 'FAIL' end);

  -- Revoke one before the scheduler runs.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.project_entitlement_events (project_id, service_key, action, actor, note)
  values (v_proj, 'renders', 'revoke', v_staff, 'proof');
  reset role;
  v_reason := public.gl_portal_email_block_reason(v_row);
  insert into proof(assertion, observed, verdict) values
    ('R4: revoking an announced service before send blocks the email, naming the service', coalesce(v_reason, 'no block'),
     case when v_reason like 'announced service no longer open:%renders%' then 'PASS' else 'FAIL' end);

  -- Re-grant: the claim is true again, so the check no longer blocks.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.project_entitlement_events (project_id, service_key, action, actor, note)
  values (v_proj, 'renders', 'grant', v_staff, 'proof');
  reset role;
  v_reason := public.gl_portal_email_block_reason(v_row);
  insert into proof(assertion, observed, verdict) values
    ('the check follows the latest event: re-granted, the email may send again', coalesce(v_reason, 'no block'),
     case when v_reason is null then 'PASS' else 'FAIL' end);

  -- A service row queued before this change has no list and cannot be verified.
  insert into public.email_schedule (to_email, subject, body, send_at, status, portal_event)
  select e.to_email, 'zz legacy service', 'x', now(), 'pending',
         jsonb_build_object('kind','service','ref',v_proj,'client_id',v_client,'pref','project')
    from public.email_schedule e where e.id = v_row
  returning id into v_legacy;
  v_reason := public.gl_portal_email_block_reason(v_legacy);
  insert into proof(assertion, observed, verdict) values
    ('a service announcement without a service list is skipped, not sent unverified', coalesce(v_reason, 'no block'),
     case when v_reason like 'service announcement does not list%' then 'PASS' else 'FAIL' end);

  -- Milestone announcements keep their project check and are not affected.
  insert into public.email_schedule (to_email, subject, body, send_at, status, portal_event)
  select e.to_email, 'zz milestone', 'x', now(), 'pending',
         jsonb_build_object('kind','milestone','ref',v_proj,'client_id',v_client,'pref','project')
    from public.email_schedule e where e.id = v_row
  returning id into v_ms;
  v_reason := public.gl_portal_email_block_reason(v_ms);
  insert into proof(assertion, observed, verdict) values
    ('milestone announcements are unchanged (active project: may send)', coalesce(v_reason, 'no block'),
     case when v_reason is null then 'PASS' else 'FAIL' end);
  update public.projects set archived_at = now() where id = v_proj;
  v_reason := public.gl_portal_email_block_reason(v_row);
  insert into proof(assertion, observed, verdict) values
    ('an archived project still blocks a service announcement', coalesce(v_reason, 'no block'),
     case when v_reason like 'project is archived%' then 'PASS' else 'FAIL' end);

  -- Customers still cannot call the gate.
  insert into proof(assertion, observed, verdict) values
    ('the send-time check is not callable by anon or authenticated',
     has_function_privilege('anon', 'public.gl_portal_email_block_reason(uuid)', 'execute') || '/' ||
     has_function_privilege('authenticated', 'public.gl_portal_email_block_reason(uuid)', 'execute'),
     case when not has_function_privilege('anon', 'public.gl_portal_email_block_reason(uuid)', 'execute')
           and not has_function_privilege('authenticated', 'public.gl_portal_email_block_reason(uuid)', 'execute')
          then 'PASS' else 'FAIL' end);
end
$proof$;

select seq, verdict, assertion, observed from proof order by seq;

-- Nothing is kept, and nothing is emailed: the scheduler is never called.
rollback;
