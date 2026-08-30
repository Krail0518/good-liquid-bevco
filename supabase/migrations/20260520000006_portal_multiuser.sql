-- ============================================================
-- Multi-user portal accounts
-- ============================================================
-- A single brand (client) needs more than one portal login so the
-- AP person, the ops person, and the buyer can all see invoices /
-- production runs without sharing a password. The customer_users
-- table already allowed multiple rows per client_id (auth_user_id
-- is unique, client_id is not), but two things were missing:
--
-- 1. A role distinction — the first invited user is the "owner" and
--    can invite/remove teammates; later users are "members" and can
--    view-only. This migration adds `customer_users.role` defaulting
--    to 'owner' so every existing row stays at owner privilege.
--
-- 2. A self-invite RPC so the owner can add a teammate from the
--    portal account modal WITHOUT needing a CRM admin to do it.
--    `portal_invite_teammate(email, display_name)` creates the
--    auth user (or reuses if they already exist) and links them
--    to the caller's client_id with role='member'.
--
-- 3. A widened self-read policy so any portal user on a given
--    client can list other portal users on the same client (for
--    the Teammates section in account settings). Previously,
--    "customer_users self read" only allowed reading the caller's
--    own row.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── 1) role column ─────────────────────────────────────────────────
alter table public.customer_users
  add column if not exists role text not null default 'owner';
alter table public.customer_users
  drop constraint if exists customer_users_role_check;
alter table public.customer_users
  add constraint customer_users_role_check check (role in ('owner','member'));

comment on column public.customer_users.role is
  'Portal role: "owner" can invite/remove teammates and edit account; "member" is view-only. First user invited per client is owner by default.';

-- ── 2) widened self-read policy ────────────────────────────────────
-- The original "customer_users self read" only let a user see THEIR
-- own row. To render a Teammates list, they need to see every row
-- whose client_id matches their own client_id.
drop policy if exists "customer_users self read" on public.customer_users;
create policy "customer_users self read" on public.customer_users
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or client_id = public.current_customer_client_id()
  );

-- ── 3) portal_invite_teammate RPC ──────────────────────────────────
-- Called from the portal account modal. Must be SECURITY DEFINER
-- because:
--   • The caller is a portal customer (no insert privilege on
--     customer_users) — only staff have direct INSERT permission
--     since the security_hardening migration tightened the policy.
--   • The function looks up auth.users by lowered email, which
--     requires service-role-level access to the auth schema.
--
-- Authorization: only callers who are themselves customer_users
-- (i.e. they have a row) AND have role='owner' AND are active can
-- invite. The newly invited user is always role='member' regardless
-- of what the caller passed (no privilege escalation via this path).
create or replace function public.portal_invite_teammate(
  p_email        text,
  p_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text := lower(trim(p_email));
  v_caller     uuid := auth.uid();
  v_client_id  uuid;
  v_caller_row public.customer_users%rowtype;
  v_user_id    uuid;
  v_existing   uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  -- Caller must be an active OWNER on some client.
  select * into v_caller_row
    from public.customer_users
    where auth_user_id = v_caller
      and active = true
    limit 1;
  if v_caller_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_portal_user');
  end if;
  if coalesce(v_caller_row.role, 'member') <> 'owner' then
    return jsonb_build_object('ok', false, 'error', 'only_owners_can_invite');
  end if;
  v_client_id := v_caller_row.client_id;

  -- Try to find an existing auth user for that email.
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  -- If they already exist AND already have a customer_users row,
  -- decide based on whether it's on this same client.
  if v_user_id is not null then
    select id into v_existing from public.customer_users where auth_user_id = v_user_id limit 1;
    if v_existing is not null then
      -- Reuse the existing row if it's on the same client; otherwise
      -- refuse so we don't yank a customer out from under another brand.
      update public.customer_users
         set client_id = v_client_id,
             email     = v_email,
             active    = true,
             display_name = coalesce(p_display_name, display_name)
       where id = v_existing
         and client_id = v_client_id;
      if found then
        return jsonb_build_object('ok', true, 'action', 'reactivated', 'auth_user_id', v_user_id);
      end if;
      return jsonb_build_object('ok', false, 'error', 'email_already_linked_to_another_brand');
    end if;

    -- Auth user exists but no customer_users row yet — link them.
    insert into public.customer_users (auth_user_id, client_id, email, display_name, role, active, invited_by)
    values (v_user_id, v_client_id, v_email, p_display_name, 'member', true, v_caller);
    return jsonb_build_object('ok', true, 'action', 'linked', 'auth_user_id', v_user_id);
  end if;

  -- Auth user doesn't exist yet. We can't create one from inside a
  -- security-definer function (that needs the service role from outside
  -- pg). Return a sentinel so the client knows to call signUp / send
  -- the reset email itself, THEN call this RPC again.
  return jsonb_build_object('ok', false, 'error', 'auth_user_not_found', 'email', v_email);
end
$$;
grant execute on function public.portal_invite_teammate(text, text) to authenticated;

-- ── 4) portal_remove_teammate RPC ──────────────────────────────────
-- Lets an owner deactivate (not delete) a teammate's portal access.
-- An owner cannot remove themselves through this RPC (they would
-- lock the brand out); use SQL/admin tools for that edge case.
create or replace function public.portal_remove_teammate(
  p_customer_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_caller_row public.customer_users%rowtype;
  v_target     public.customer_users%rowtype;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select * into v_caller_row
    from public.customer_users
    where auth_user_id = v_caller
      and active = true
    limit 1;
  if v_caller_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_portal_user');
  end if;
  if coalesce(v_caller_row.role,'member') <> 'owner' then
    return jsonb_build_object('ok', false, 'error', 'only_owners_can_remove');
  end if;
  if p_customer_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_id');
  end if;
  select * into v_target from public.customer_users where id = p_customer_user_id limit 1;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'target_not_found');
  end if;
  if v_target.client_id <> v_caller_row.client_id then
    return jsonb_build_object('ok', false, 'error', 'target_on_different_brand');
  end if;
  if v_target.id = v_caller_row.id then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_self');
  end if;
  update public.customer_users set active = false where id = p_customer_user_id;
  return jsonb_build_object('ok', true, 'action', 'deactivated', 'id', p_customer_user_id);
end
$$;
grant execute on function public.portal_remove_teammate(uuid) to authenticated;

notify pgrst, 'reload schema';
