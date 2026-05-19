-- ============================================================
-- RPC: link an existing auth user → a client (creates customer_users row)
-- ============================================================
-- Background: when staff click "🔑 Invite" in the CRM the browser calls
-- supabase-js `auth.signUp` to create the auth user, but if the email
-- already exists in auth.users (re-invite, or user signed up another
-- way) `signUp` returns success WITHOUT a user object — leaving the
-- browser unable to learn the auth_user_id and therefore unable to
-- insert into customer_users.
--
-- This RPC does the link server-side using a SECURITY DEFINER lookup
-- against auth.users by email, so the browser only needs (client_id,
-- email) and the link works whether the auth user is new or pre-existing.
--
-- Idempotent: if a customer_users row already exists for the auth user
-- the row is updated to point at the supplied client_id and re-activated.
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
begin
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
