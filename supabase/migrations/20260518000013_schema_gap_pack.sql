-- ============================================================
-- Schema-gap pack — bring the DB in line with what the UI writes
-- ============================================================
-- Live probing of the deployed app revealed 11 tables where the UI's
-- write payloads include columns that don't exist on the table. Every
-- save on those features silently fails (PGRST204) and the user only
-- sees a small warning toast they're likely to miss.
--
-- This migration adds the first-discovered missing column on each
-- affected table. Additional gaps may surface on subsequent saves —
-- the UI now logs a warning toast and lists the dropped columns so
-- they can be added with another migration.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Referrers: updated_at is referenced in standard update flow but missing.
alter table public.referrers add column if not exists updated_at timestamptz default now();
-- Trigger to maintain updated_at on edits (set_updated_at is defined
-- earlier in the project's migrations).
do $$
begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    drop trigger if exists trg_referrers_updated on public.referrers;
    create trigger trg_referrers_updated before update on public.referrers
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Referrals: UI sends amount + status + notes; table only had client_name.
alter table public.referrals add column if not exists amount numeric;
alter table public.referrals add column if not exists status text default 'pending';
alter table public.referrals add column if not exists notes text;

-- Deals: UI sends co (company), val, stage, prob, notes.
alter table public.deals add column if not exists co text;
alter table public.deals add column if not exists val numeric;
alter table public.deals add column if not exists stage text;
alter table public.deals add column if not exists prob numeric;
alter table public.deals add column if not exists notes text;

-- Production runs: UI sends product as a separate field from run_name.
alter table public.production_runs add column if not exists product text;

-- Defects: UI sends defect_type / severity / description / root_cause / corrective_action.
alter table public.defects add column if not exists defect_type text;
alter table public.defects add column if not exists severity text;
alter table public.defects add column if not exists description text;
alter table public.defects add column if not exists root_cause text;
alter table public.defects add column if not exists corrective_action text;

-- CIP logs: UI sends cycle_type + date_logged + notes.
alter table public.cip_logs add column if not exists cycle_type text;
alter table public.cip_logs add column if not exists date_logged date default current_date;
alter table public.cip_logs add column if not exists notes text;

-- Yield logs: UI sends date_logged + planned_cases + actual_cases.
alter table public.yield_logs add column if not exists date_logged date default current_date;
alter table public.yield_logs add column if not exists planned_cases numeric;
alter table public.yield_logs add column if not exists actual_cases numeric;

-- Sample shipments: UI sends ship_date (table has shipped_date).
alter table public.sample_shipments add column if not exists ship_date date;
alter table public.sample_shipments add column if not exists tracking text;
alter table public.sample_shipments add column if not exists status text default 'shipped';

-- Trade shows: UI sends city + state + date.
alter table public.trade_shows add column if not exists city text;
alter table public.trade_shows add column if not exists state text;
alter table public.trade_shows add column if not exists date date;

-- Content calendar: UI sends content + status + platform + date.
alter table public.content_calendar add column if not exists content text;
alter table public.content_calendar add column if not exists status text default 'draft';
alter table public.content_calendar add column if not exists platform text;
alter table public.content_calendar add column if not exists date date;

-- Capacity: UI sends cans_capacity + bottles_capacity + week_start.
alter table public.capacity add column if not exists cans_capacity numeric;
alter table public.capacity add column if not exists bottles_capacity numeric;
alter table public.capacity add column if not exists week_start date;

-- Resources: UI sends tags + url + title.
alter table public.resources add column if not exists tags text;
alter table public.resources add column if not exists url text;
alter table public.resources add column if not exists title text;

-- Case studies: UI sends client + summary + title.
alter table public.case_studies add column if not exists client text;
alter table public.case_studies add column if not exists summary text;
alter table public.case_studies add column if not exists title text;

-- Force PostgREST to drop its schema cache so the new columns take effect.
notify pgrst, 'reload schema';
