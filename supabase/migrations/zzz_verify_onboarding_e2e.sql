-- NOT A MIGRATION — end-to-end verification harness for the onboarding flow,
-- run via the Apply-SQL workflow and then deleted. The "zzz_" prefix keeps it
-- out of any ordered migration run.
--
-- Deliberately does NOT touch is_staff_user() (redefining a security function,
-- even briefly, is the class of shortcut that caused earlier outages). The
-- staff-only create RPC is covered by the browser sweep; here we insert the
-- onboarding row directly (the Management API is already privileged) and then
-- exercise the two ANON-facing RPCs that carry the real risk — gl_onboarding_get
-- and gl_onboarding_submit — verifying the answers land on the client row.
-- Creates a clearly-labeled throwaway client and removes everything at the end
-- (on-delete cascade drops the onboarding row with it).
do $$
declare
  v_client uuid;
  v_token  text := encode(gen_random_bytes(24), 'hex');
  v_get    jsonb;
  v_submit jsonb;
  v_legal  text;
  v_city   text;
  v_ob     text;
begin
  insert into public.clients (name, contact_name, email, status, onboarding_status)
  values ('ZZZ Onboarding E2E (delete me)', 'Test Contact', 'e2e@onboarding.test', 'onboarding', 'invited')
  returning id into v_client;

  insert into public.onboarding (client_id, token, status, contact_email, prefill)
  values (v_client, v_token, 'invited', 'e2e@onboarding.test',
          jsonb_build_object('company','ZZZ Onboarding E2E (delete me)','name','Test Contact',
                             'email','e2e@onboarding.test','city','Palmetto','state','FL','service','canning'));

  -- Public read (also flips invited → started).
  v_get := public.gl_onboarding_get(v_token);
  raise notice 'GET: %', v_get;
  if (v_get->>'ok') <> 'true' then raise exception 'E2E FAIL: get returned %', v_get; end if;

  -- A bad token must be rejected.
  if (public.gl_onboarding_get('not-a-real-token-xxxxxxxxxxxxxxxxxxxxxxxx')->>'ok') = 'true' then
    raise exception 'E2E FAIL: a bogus token was accepted';
  end if;

  -- Public submit with the completed answers.
  v_submit := public.gl_onboarding_submit(
    v_token,
    jsonb_build_object('contact_name','Test Contact','legal_name','ZZZ Legal LLC',
                       'street','1 Test Way','city','Bradenton','state','FL','zip','34205',
                       'billing_city','Bradenton','service','12oz canning','notes','e2e run'));
  raise notice 'SUBMIT: %', v_submit;
  if (v_submit->>'ok') <> 'true' then raise exception 'E2E FAIL: submit returned %', v_submit; end if;

  -- Resubmit must be refused (already submitted).
  if (public.gl_onboarding_submit(v_token, '{}'::jsonb)->>'ok') = 'true' then
    raise exception 'E2E FAIL: a second submit was accepted';
  end if;

  -- Verify the answers propagated to the client and the row is submitted.
  select legal_name, city into v_legal, v_city from public.clients where id = v_client;
  select status into v_ob from public.onboarding where client_id = v_client;
  raise notice 'RESULT: client.legal_name=% client.city=% onboarding.status=%', v_legal, v_city, v_ob;

  if v_legal = 'ZZZ Legal LLC' and v_city = 'Bradenton' and v_ob = 'submitted' then
    raise notice 'E2E PASS ✅ get → submit → client updated, bad token rejected, double-submit blocked.';
  else
    raise exception 'E2E FAIL: legal=% city=% status=%', v_legal, v_city, v_ob;
  end if;

  delete from public.clients where id = v_client;   -- cascades to onboarding
  raise notice 'CLEANUP done.';
end $$;
