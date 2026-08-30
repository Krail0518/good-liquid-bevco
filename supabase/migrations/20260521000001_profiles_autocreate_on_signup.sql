-- ============================================================
-- Auto-create public.profiles on auth.users INSERT + backfill
-- ============================================================
-- Caught via Playwright runtime audit on 2026-05-21. Mike's logged-in
-- admin account (mike@goodliquid.com) had NO public.profiles row, so
-- the CRM topbar badge fell back to the lowest-privilege display
-- ("Sales") instead of "Admin." Same issue had been one-off-fixed for
-- Darius earlier in the project, but there was never an auto-create
-- mechanism — so every new auth signup starts with a missing profile
-- and the CRM treats them as a default-role user.
--
-- This migration ships three pieces:
--   1. A handle_new_user() trigger function (SECURITY DEFINER) that
--      auto-inserts a public.profiles row whenever a new auth.users
--      row appears.
--   2. A one-time backfill INSERT that creates rows for every
--      existing auth.users entry that doesn't already have a profile.
--   3. An explicit role='admin' update for mike@goodliquid.com so
--      Mike's session immediately picks up the right gating after
--      the next page reload.
--
-- The default role for auto-created profiles is 'sales' (lowest
-- granular role with normal access). Admins are explicitly promoted
-- via the existing Users & Permissions UI (glChangeUserRole).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Trigger function ──────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initials text;
begin
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

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── (2) Backfill existing auth.users missing profiles ─────────────
insert into public.profiles (id, email, name, role, status, initials, color, tc)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  'sales',
  'active',
  upper(left(coalesce(u.email, ''), 2)),
  '#1a3a6e',
  '#9FE1CB'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ── (3) Promote Mike to admin (his missing-then-backfilled row
--       defaults to 'sales' — bump it to admin so his next page
--       reload shows the right badge + unlocks admin gates). ─────
update public.profiles
   set role = 'admin', name = coalesce(nullif(name, ''), 'Mike Krail')
 where email = 'mike@goodliquid.com';

notify pgrst, 'reload schema';
