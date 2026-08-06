-- ============================================================
-- Fix: onboarding self-service portal signups silently failed to link
-- ============================================================
-- The 2026-07-25 security hardening locked link_customer_user_by_email() to
-- is_staff_user() (a portal customer could otherwise re-point their own
-- customer_users row at ANY client — cross-customer takeover). That gate is
-- correct for browser callers, but it also blocked the onboarding-set-password
-- edge function, which calls this RPC as the SERVICE ROLE (no staff JWT). The
-- RPC returned { ok:false, error:'forbidden' } as DATA, the edge function only
-- warned on link.error (null here), and the result was: a client who finished
-- onboarding got a password but NO customer_users row — they could sign in yet
-- the portal rejected them ("not a customer portal account").
--
-- The service role is only ever used by trusted server-side code (edge
-- functions), never exposed to a browser, so letting it through the gate is
-- safe. Everything else stays staff-only. The edge function has also been
-- rewritten to link directly (belt-and-suspenders); this keeps the RPC path
-- working for the currently-deployed function and any other service-role caller.
-- ============================================================

create or replace function public.link_customer_user_by_email(
  p_client_id uuid,
  p_email     text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email   text := lower(trim(p_email));
  v_user_id uuid;
  v_row_id  uuid;
  v_role    text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
begin
  -- Staff (CRM users) may link a customer login to a client. The service role
  -- (trusted server code — the onboarding edge function) may too. Nobody else.
  if not public.is_staff_user() and v_role <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_client_id');
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_auth_user', 'email', v_email);
  end if;

  select id into v_row_id from public.customer_users where auth_user_id = v_user_id limit 1;
  if v_row_id is not null then
    update public.customer_users
       set client_id    = p_client_id,
           email        = v_email,
           active       = true
     where id = v_row_id;
    return jsonb_build_object('ok', true, 'action', 'updated', 'auth_user_id', v_user_id);
  end if;

  insert into public.customer_users (auth_user_id, client_id, email, active)
  values (v_user_id, p_client_id, v_email, true);
  return jsonb_build_object('ok', true, 'action', 'created', 'auth_user_id', v_user_id);
end
$$;

grant execute on function public.link_customer_user_by_email(uuid, text) to authenticated;

notify pgrst, 'reload schema';
