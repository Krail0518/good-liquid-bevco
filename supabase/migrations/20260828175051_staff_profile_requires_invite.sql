-- Staff profiles may only be created for admin-invited users.
--
-- ROLLBACK:
--   Re-apply 20260806100000_no_staff_profile_for_portal_customers.sql, which
--   contains the previous definition of public.handle_new_user(). The trigger
--   itself is unchanged, so no trigger DDL is needed either way.
--
-- WHY
-- ---
-- handle_new_user() was a DENYLIST: it created an active 'sales' staff profile
-- for every new auth user EXCEPT those whose signup metadata carried
-- portal_customer='true' or onboarded='true'. Those flags are set only by the
-- trusted browser flows (crm-portal-customer.js) and the onboarding function.
--
-- A raw POST /auth/v1/signup carries neither. The publishable key that reaches
-- it ships in the page source, and Supabase signup is open. So any stranger
-- could self-register and receive an active profiles row.
--
-- An active profiles row IS the definition of staff:
--
--     -- 20260807020000_tenant_isolation_guard.sql
--     select auth.uid() is not null and exists (
--       select 1 from public.profiles p
--       where p.id = auth.uid() and coalesce(p.status,'active') <> 'inactive'
--     );
--
-- so is_gl_staff() returned true, the RESTRICTIVE tenant guard passed, and the
-- legacy permissive "<table> authed all" policies from 20260518_rls_authed_all.sql
-- — which were never dropped — granted full CRUD on every CRM table, the
-- client-docs bucket, and link_customer_user_by_email. Portal customers are
-- competing beverage brands, so that is a cross-tenant exposure.
--
-- This directly contradicted the guard's own stated premise:
--   "a self-registered account with neither — sees nothing"
--
-- THE FIX
-- -------
-- Invert to an ALLOWLIST. auth.users.invited_at is set by the admin API
-- (inviteUserByEmail, used by the invite-staff-user edge function) and CANNOT
-- be set by a self-service signup. Gate on it.
--
-- This does not disturb staff onboarding: invite-staff-user already upserts the
-- profile row itself after inviting (supabase/functions/invite-staff-user/index.ts),
-- so the trigger is a convenience for that path, not its only mechanism.
--
-- Verified against production before writing (2026-08-28): six profiles exist,
-- five predate or sit outside the invite flow and are known staff; the trigger
-- is live (trg_on_auth_user_created, tgenabled='O') and its deployed definition
-- gates on metadata only, matching the source. No unexpected account had been
-- created through this hole.
--
-- The pre-existing portal-linked profile is deliberately NOT touched here; that
-- is a separate data question, handled outside this migration.
--
-- IMPORTANT: this trigger IS load-bearing for staff invites. profiles.email is
-- NOT NULL with no default, and invite-staff-user's own upsert omits email, so
-- it depends on this trigger having created the row first. Gating on invited_at
-- keeps that path intact; skipping profile creation outright would break staff
-- onboarding with a not-null violation.
--
-- APPLIED to production 2026-08-28 as version 20260828175051, after a
-- rolled-back behavioural test of four branches:
--   A bare self-signup                        -> no profile   PASS
--   B self-signup forging {"role":"admin"}    -> no profile   PASS
--   C invited portal customer                 -> no profile   PASS
--   D genuine admin invite                    -> profile made PASS
-- profiles count unchanged at 6 before and after; 6 active, 8 portal users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_initials text;
begin
  -- ALLOWLIST: only an admin-invited user may receive a staff profile.
  -- Self-service signup (invited_at is null) gets nothing. Do not weaken this
  -- to a metadata check — metadata is supplied by the caller.
  if new.invited_at is null then
    return new;
  end if;

  -- Belt and braces: portal customers are tracked in customer_users, never in
  -- profiles, even in the event they are ever invited through the admin API.
  if coalesce(new.raw_user_meta_data->>'onboarded','') = 'true'
     or coalesce(new.raw_user_meta_data->>'portal_customer','') = 'true' then
    return new;
  end if;

  v_initials := upper(left(coalesce(new.email, ''), 2));
  insert into public.profiles (id, email, name, role, status, initials, color, tc)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'sales',
    'active',
    v_initials,
    '#1a3a6e',
    '#9FE1CB'
  )
  on conflict (id) do nothing;
  return new;
end
$$;

comment on function public.handle_new_user() is
  'Creates a staff profile ONLY for admin-invited auth users (invited_at is not '
  'null). Self-service signup must never produce a profiles row, because an '
  'active profiles row is what is_gl_staff() treats as staff.';
