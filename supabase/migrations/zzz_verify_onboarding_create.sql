-- NOT A MIGRATION — verification harness, run via Apply-SQL then deleted.
-- This time it calls the REAL gl_onboarding_create RPC (the earlier harness
-- bypassed it with a direct insert, which is exactly why the gen_random_bytes
-- bug slipped through). The whole thing runs as one atomic DO block: it
-- temporarily makes is_staff_user() return true so the staff-gated create RPC
-- runs, then RESTORES the real definition and deletes the throwaway client at
-- the end. Postgres DDL is transactional, so if any step raises, the block
-- rolls back and both the override AND the test data disappear automatically —
-- is_staff_user() can never be left loosened.
do $$
declare
  v_client uuid;
  v_create jsonb;
  v_token  text;
  v_get    jsonb;
  v_submit jsonb;
  v_legal  text; v_city text; v_ob text;
begin
  create or replace function public.is_staff_user() returns boolean
    language sql stable as $f$ select true $f$;

  insert into public.clients (name, contact_name, email, status, onboarding_status)
  values ('ZZZ Create E2E (delete me)', 'Test Contact', 'e2e2@onboarding.test', 'active', 'invited')
  returning id into v_client;

  -- The real staff RPC — this is what exercises the token generation.
  v_create := public.gl_onboarding_create(
    v_client,
    jsonb_build_object('company','ZZZ Create E2E (delete me)','name','Test Contact',
                       'email','e2e2@onboarding.test','city','Palmetto','state','FL','service','canning'),
    null);
  raise notice 'CREATE: %', v_create;
  if (v_create->>'ok') <> 'true' then raise exception 'create returned %', v_create; end if;
  v_token := v_create->>'token';
  if v_token is null or length(v_token) < 32 then raise exception 'token too short: %', v_token; end if;

  v_get := public.gl_onboarding_get(v_token);
  if (v_get->>'ok') <> 'true' then raise exception 'get returned %', v_get; end if;

  v_submit := public.gl_onboarding_submit(v_token,
    jsonb_build_object('contact_name','Test Contact','legal_name','ZZZ Legal LLC',
                       'city','Bradenton','service','12oz canning'));
  if (v_submit->>'ok') <> 'true' then raise exception 'submit returned %', v_submit; end if;

  select legal_name, city into v_legal, v_city from public.clients where id = v_client;
  select status into v_ob from public.onboarding where client_id = v_client;
  raise notice 'RESULT client.legal_name=% client.city=% onboarding.status=%', v_legal, v_city, v_ob;
  if not (v_legal = 'ZZZ Legal LLC' and v_city = 'Bradenton' and v_ob = 'submitted') then
    raise exception 'client not updated: legal=% city=% status=%', v_legal, v_city, v_ob;
  end if;

  raise notice 'E2E PASS ✅ create → get → submit → client updated (real RPCs).';

  -- Clean up and restore the real is_staff_user() (exact definition from
  -- migration 20260730010000). On any earlier raise, rollback does this for us.
  delete from public.clients where id = v_client;
  create or replace function public.is_staff_user()
  returns boolean language sql stable security definer set search_path = public as $f$
    select auth.uid() is not null
       and (
         exists (select 1 from public.profiles where id = auth.uid() and coalesce(status,'active') <> 'inactive')
         or not exists (select 1 from public.customer_users where auth_user_id = auth.uid() and active = true)
       );
  $f$;
end $$;
