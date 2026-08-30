-- ============================================================
-- Super-user enforcement at the database layer
-- ============================================================
-- Closes the DevTools-bypass attack vector:
--   Today, most table policies are
--     `for all to authenticated using (true) with check (true)`
--   so any signed-in admin (or, if a policy gap exists, any portal
--   customer) can open browser DevTools and run a bulk DELETE that
--   wipes a table — the JS UI gates from PR #148 hide the buttons
--   but don't actually stop the operation.
--
-- This migration moves the super-user check INTO the database:
--   1. profiles.is_super_user boolean (default false)
--   2. backfill mike@goodliquid.com → true
--   3. public.is_super_user() SECURITY DEFINER function that
--      consults the calling JWT's user row
--   4. Tightened DELETE + sensitive UPDATE policies on the
--      high-value tables: clients, profiles, invoices,
--      production_runs, inspector_tokens
--
-- Other admins keep SELECT/INSERT/normal-UPDATE so day-to-day work
-- continues. They just can't destroy data from DevTools.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Column + backfill ────────────────────────────────────
alter table public.profiles
  add column if not exists is_super_user boolean not null default false;

-- Promote the workspace owner. Hardcoded email is fine — this is a
-- one-row backfill and the column makes future promotions a single
-- UPDATE away.
update public.profiles
   set is_super_user = true
 where email = 'mike@goodliquid.com'
   and is_super_user is not true;

comment on column public.profiles.is_super_user is
  'When true, the user can perform destructive operations (delete clients/invoices/profiles, change roles, etc.) that other admins cannot. Enforced at the RLS layer — DevTools cannot bypass.';

-- ── (2) SECURITY DEFINER check ───────────────────────────────
create or replace function public.is_super_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_super_user from public.profiles where id = auth.uid()),
    false
  );
$$;

comment on function public.is_super_user() is
  'Returns true iff the calling user has profiles.is_super_user = true. Used in RLS policies to gate destructive operations server-side so DevTools cannot bypass UI gates.';

-- ── (3) Tightened policies — DELETE + sensitive UPDATE ───────
-- Pattern per table:
--   • Keep existing SELECT / INSERT / normal-UPDATE policies as-is
--     (admins still do their job).
--   • Replace any blanket DELETE policy with a super-user-only one.
--   • For tables where UPDATE can effectively delete data (e.g.
--     profile.role, profile.status, profile.is_super_user), add a
--     companion UPDATE policy that requires super_user on those
--     specific columns OR keeps the normal admin update on the
--     non-destructive columns.

-- ───── public.clients ─────
-- Existing "clients authed" allows all-to-authenticated. We keep
-- the SELECT/INSERT/UPDATE side via a narrower policy and gate
-- DELETE on super-user.
drop policy if exists "clients authed" on public.clients;
drop policy if exists "clients staff select" on public.clients;
drop policy if exists "clients staff insert" on public.clients;
drop policy if exists "clients staff update" on public.clients;
drop policy if exists "clients super delete" on public.clients;

create policy "clients staff select" on public.clients
  for select to authenticated using (public.is_staff_user());

create policy "clients staff insert" on public.clients
  for insert to authenticated with check (public.is_staff_user());

create policy "clients staff update" on public.clients
  for update to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

create policy "clients super delete" on public.clients
  for delete to authenticated using (public.is_super_user());

-- ───── public.profiles ─────
-- Profiles are special: the user owns their own row (can update
-- their own name/email/preferences), staff can see all rows, but
-- changing role / status / is_super_user requires super_user.
-- The existing self-profile policies should stay; we layer the
-- destructive guard on top via a column-aware UPDATE policy.
drop policy if exists "profiles super delete" on public.profiles;
drop policy if exists "profiles super role change" on public.profiles;

create policy "profiles super delete" on public.profiles
  for delete to authenticated using (public.is_super_user());

-- Defense in depth: if any admin tries to mass-update profiles
-- (e.g., promote themselves to super_user via DevTools), the
-- column-level check in the trigger below blocks it. Triggers
-- enforce regardless of which RLS path the request took.
create or replace function public.profiles_block_sensitive_updates()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Allow if caller is super_user.
  if public.is_super_user() then
    return new;
  end if;
  -- Allow same-user self-edits ONLY on non-sensitive columns.
  -- Block any change to role / status / is_super_user when caller
  -- is not super.
  if new.role is distinct from old.role then
    raise exception 'Changing role requires super-user privilege.';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Changing status requires super-user privilege.';
  end if;
  if new.is_super_user is distinct from old.is_super_user then
    raise exception 'Changing is_super_user requires super-user privilege.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_block_sensitive on public.profiles;
create trigger trg_profiles_block_sensitive
  before update on public.profiles
  for each row execute function public.profiles_block_sensitive_updates();

-- ───── public.invoices ─────
-- DELETE is destructive; UPDATE of any column is fine for admins
-- (they need to mark paid, edit amounts, etc.).
drop policy if exists "invoices super delete" on public.invoices;
create policy "invoices super delete" on public.invoices
  for delete to authenticated using (public.is_super_user());

-- ───── public.production_runs ─────
drop policy if exists "production_runs super delete" on public.production_runs;
create policy "production_runs super delete" on public.production_runs
  for delete to authenticated using (public.is_super_user());

-- ───── public.inspector_tokens ─────
-- Already locked to staff for write (PR #147). Tighten further:
-- DELETE requires super_user (revoke stays as an UPDATE which any
-- staff can do).
drop policy if exists "inspector_tokens staff delete" on public.inspector_tokens;
create policy "inspector_tokens super delete" on public.inspector_tokens
  for delete to authenticated using (public.is_super_user());

notify pgrst, 'reload schema';
