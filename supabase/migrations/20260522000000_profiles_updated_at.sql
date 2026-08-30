-- ============================================================
-- Add updated_at column to public.profiles + auto-bump trigger
-- ============================================================
-- Caught when Mike clicked Deactivate on a staff row and got
-- "Could not find the 'updated_at' column of 'profiles' in the
-- schema cache." Multiple code paths (the new fix #18
-- glToggleUserActive + the legacy removeUser at fix.js:455) set
-- `updated_at: new Date().toISOString()` in their UPDATE payload,
-- but the column was never created — so PostgREST 400'd and the
-- click silently bounced. Danny's profile stayed `status='active'`
-- with no UI indication that anything failed.
--
-- This adds the column + a trigger that auto-bumps it on every
-- UPDATE, so the existing code paths just work. Idempotent.
-- ============================================================

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

-- The set_updated_at() function already exists in this project
-- (created in 20260516_new_feature_tables.sql) — just attach it.
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
