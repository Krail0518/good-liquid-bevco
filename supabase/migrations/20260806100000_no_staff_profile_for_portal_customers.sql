-- ════════════════════════════════════════════════════════════════
-- Portal customers must NOT get a staff profiles row
-- ════════════════════════════════════════════════════════════════
-- profiles is the STAFF roster: it feeds is_staff_user(), the Users &
-- Permissions page, and every admin RLS check. But handle_new_user()
-- fired for EVERY new auth user — including portal customers created by
-- the onboarding form (onboarding-set-password) and the invite-customer
-- flows — silently granting each new client an active 'sales' staff
-- profile. Found while fixing the Patizan Energy portal login
-- (2026-08-06): the client passed is_staff_user() while their actual
-- portal link row was missing.
--
-- Fix: skip the profiles insert when the auth user is flagged as a
-- portal customer. The flags:
--   • onboarded=true       — set by onboarding-set-password createUser
--   • portal_customer=true — set by the browser signUp calls in
--                            crm-portal-customer.js (invite flows)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_initials text;
begin
  -- Portal customers are tracked in customer_users, not profiles.
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
