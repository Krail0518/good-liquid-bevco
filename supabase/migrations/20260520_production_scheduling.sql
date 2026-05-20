-- ============================================================
-- Capacity-aware production scheduling
-- ============================================================
-- Replaces the single-day "scheduled_date" field on production_runs
-- with a real start/end date range and assigns each run to a physical
-- production_line. Lets the CRM:
--   • Warn when two runs are booked on the same line on overlapping days
--   • Surface line utilization for the week ("Canning Line 1: 4 runs,
--     ~800 cases of 1000 cases/day capacity")
--   • Show portal customers WHEN their run is on the line (not just
--     a single target date that turned into a guess)
--
-- Backwards-compatible: `scheduled_date` stays as the run's primary
-- start date and back-fills `scheduled_start_date`. `scheduled_end_date`
-- is nullable — single-day runs leave it null and the UI treats that
-- as "1-day block."
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── 1) production_lines ───────────────────────────────────────────
create table if not exists public.production_lines (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  kind                 text not null default 'canning'
                       check (kind in ('canning','bottling','rd','blending','other')),
  capacity_per_day     numeric(10,2),       -- cases/day for canning+bottling, hours/day for rd
  capacity_unit        text not null default 'cases',
                       -- 'cases' for canning/bottling, 'hours' for rd
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_production_lines_active on public.production_lines(active);

drop trigger if exists trg_production_lines_updated on public.production_lines;
create trigger trg_production_lines_updated before update on public.production_lines
  for each row execute function public.set_updated_at();

alter table public.production_lines enable row level security;
drop policy if exists "production_lines staff all" on public.production_lines;
create policy "production_lines staff all" on public.production_lines
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());
-- Customers can SEE the line a run is booked on (helps explain why
-- their run is delayed when the line is busy). They cannot mutate.
drop policy if exists "production_lines customer read" on public.production_lines;
create policy "production_lines customer read" on public.production_lines
  for select to authenticated
  using (true);

-- ── 2) production_runs scheduling columns ─────────────────────────
alter table public.production_runs
  add column if not exists production_line_id    uuid references public.production_lines(id) on delete set null;
alter table public.production_runs
  add column if not exists scheduled_start_date  date;
alter table public.production_runs
  add column if not exists scheduled_end_date    date;

-- Back-fill scheduled_start_date from the old single scheduled_date so
-- existing runs render correctly in the new schedule view.
update public.production_runs
   set scheduled_start_date = scheduled_date
 where scheduled_start_date is null
   and scheduled_date is not null;

create index if not exists idx_production_runs_line
  on public.production_runs(production_line_id, scheduled_start_date);
create index if not exists idx_production_runs_dates
  on public.production_runs(scheduled_start_date, scheduled_end_date);

-- ── 3) Seed the three default lines if no lines exist yet ─────────
-- Skipped if the table already has rows so we never overwrite custom
-- line configs Mike has set up.
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.production_lines;
  if v_count = 0 then
    insert into public.production_lines (name, kind, capacity_per_day, capacity_unit, notes) values
      ('Canning Line 1',  'canning',  1000, 'cases', 'Primary 12oz line — Palmetto facility'),
      ('Bottling Line 1', 'bottling', 500,  'cases', 'Primary 750ml line — Palmetto facility'),
      ('R&D Bench',       'rd',       8,    'hours', 'Single bench, one formulation at a time');
  end if;
end $$;

notify pgrst, 'reload schema';
