-- Fix gl_onboarding_create: gen_random_bytes (pgcrypto) is unresolvable under
-- the function's `search_path = public` because Supabase installs pgcrypto in
-- the `extensions` schema — so "Convert to Client & Onboard" failed with
-- "function gen_random_bytes(integer) does not exist". Switch to a token built
-- from gen_random_uuid(), which is core Postgres (pg_catalog) and resolves
-- under any search_path — the same generator the cron secret already uses.
-- 64 hex chars, comfortably above the 32-char minimum the get/submit RPCs check.
create or replace function public.gl_onboarding_create(p_client_id uuid, p_prefill jsonb, p_deal_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_token text; v_email text; v_id uuid;
begin
  if not public.is_staff_user() then
    raise exception 'staff only';
  end if;
  if p_client_id is null then raise exception 'client_id required'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_email := nullif(trim(coalesce(p_prefill->>'email','')), '');
  insert into public.onboarding (client_id, deal_id, token, status, contact_email, prefill)
  values (p_client_id, p_deal_id, v_token, 'invited', v_email, coalesce(p_prefill, '{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end $$;

revoke all on function public.gl_onboarding_create(uuid, jsonb, uuid) from public, anon;
grant execute on function public.gl_onboarding_create(uuid, jsonb, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
