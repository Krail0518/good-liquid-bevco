-- ============================================================
-- Schema drift fix: sample_shipments.updated_at + trigger
-- ============================================================
-- Caught via Playwright runtime audit on 2026-05-21. The portal
-- customer dashboard SELECT for sample_shipments includes the
-- `updated_at` column (matching the original 20260516_new_feature_tables
-- definition), but PostgREST returned 42703 "column does not exist."
-- Prod schema has drifted from the migration files — likely the
-- original create-table ran partially or a later script dropped the
-- column. The `20260518_schema_gap_pack` migration tried to backfill
-- ship_date / tracking / status but missed updated_at.
--
-- This migration restores the column + the auto-update trigger so the
-- portal SELECT stops 400'ing. Idempotent — safe to apply against
-- any prod state.
-- ============================================================

alter table public.sample_shipments
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_samples_updated on public.sample_shipments;
create trigger trg_samples_updated before update on public.sample_shipments
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
