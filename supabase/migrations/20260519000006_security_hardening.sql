-- ============================================================
-- Security hardening from the 2026-05-19 audit
-- ============================================================
-- Fixes two privilege-escalation risks:
--
-- 1. link_customer_user_by_email accepted any authenticated caller —
--    a portal customer could link their auth user to ANY client and
--    instantly see that client's invoices/formulas/etc. Now requires
--    is_staff_user() at the top.
--
-- 2. customer_users "admin all" policy used `using (true)` which let
--    any authenticated user (including portal customers) read AND
--    mutate the whole customer→client mapping table. Tightened to
--    is_staff_user() for writes; self-read is unchanged. Portal users
--    keep their own row visibility via the existing self-read policy.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Auth check inside link_customer_user_by_email ───────────────────
create or replace function public.link_customer_user_by_email(
  p_client_id uuid,
  p_email     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := lower(trim(p_email));
  v_user_id uuid;
  v_row_id  uuid;
begin
  -- Only admins/staff can link customers to clients. Without this check
  -- any authenticated user (including a portal customer) could relink
  -- themselves to a different client and read that client's data.
  if not public.is_staff_user() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
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

-- ── (2) Lock down customer_users admin policy ───────────────────────────
drop policy if exists "customer_users admin all" on public.customer_users;
create policy "customer_users staff write" on public.customer_users
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- The existing "customer_users self read" policy is unchanged and still
-- lets a portal customer read their own row to learn their client_id.

notify pgrst, 'reload schema';
