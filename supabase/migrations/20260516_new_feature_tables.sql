-- ============================================================
-- Good Liquid CRM — new-feature tables
-- ============================================================
-- Creates the 14 Supabase tables that the batch 3-16 features
-- depend on. Without this migration, those features silently
-- fall back to localStorage (per-device only, no sync, no audit
-- trail across users).
--
-- Run order:
--   psql "$SUPABASE_DB_URL" -f supabase/migrations/20260516_new_feature_tables.sql
-- or via the Supabase CLI:
--   supabase db push
--
-- Idempotent: every CREATE uses IF NOT EXISTS. Safe to re-run.
-- ============================================================

-- ---------- Helper: updated_at auto-touch trigger ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ============================================================
-- 1. audit_log — append-only system log
-- ============================================================
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  action       text not null,
  target       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
create index if not exists idx_audit_log_actor      on public.audit_log(actor_id);
create index if not exists idx_audit_log_action     on public.audit_log(action);

alter table public.audit_log enable row level security;
drop policy if exists "audit_log read all authed" on public.audit_log;
create policy "audit_log read all authed" on public.audit_log
  for select to authenticated using (true);
drop policy if exists "audit_log insert authed" on public.audit_log;
create policy "audit_log insert authed" on public.audit_log
  for insert to authenticated with check (true);
-- intentionally NO update / delete policies — append-only

-- ============================================================
-- 2. capacity — single-row override for the public capacity badge
-- ============================================================
create table if not exists public.capacity (
  id           uuid primary key default gen_random_uuid(),
  quarter      text not null,
  booked       integer not null default 0,
  next_label   text,
  updated_at   timestamptz not null default now()
);

alter table public.capacity enable row level security;
drop policy if exists "capacity read public" on public.capacity;
create policy "capacity read public" on public.capacity
  for select to anon, authenticated using (true);
drop policy if exists "capacity admin write" on public.capacity;
create policy "capacity admin write" on public.capacity
  for all to authenticated using (
    exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ============================================================
-- 3. case_studies — public success-stories grid
-- ============================================================
create table if not exists public.case_studies (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  tagline       text,
  headline      text,
  body          text,
  metric        text,
  color         text default '#1a3a6e',
  tc            text default '#fff',
  published     boolean not null default false,
  display_order integer default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_case_studies_published on public.case_studies(published, display_order);
drop trigger if exists trg_case_studies_updated on public.case_studies;
create trigger trg_case_studies_updated before update on public.case_studies
  for each row execute function public.set_updated_at();

alter table public.case_studies enable row level security;
drop policy if exists "case_studies read public" on public.case_studies;
create policy "case_studies read public" on public.case_studies
  for select to anon, authenticated using (published = true);
drop policy if exists "case_studies authed full" on public.case_studies;
create policy "case_studies authed full" on public.case_studies
  for all to authenticated using (true);

-- ============================================================
-- 4. cip_logs — sanitation log (compliance)
-- ============================================================
create table if not exists public.cip_logs (
  id            uuid primary key default gen_random_uuid(),
  cycle_at      timestamptz not null default now(),
  line_area     text not null,
  method        text,
  chemicals     text,
  water_temp_f  numeric,
  contact_min   integer,
  operator      text,
  atp_reading   text,
  result        text check (result in ('pass','fail','retest')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cip_logs_cycle_at on public.cip_logs(cycle_at desc);
drop trigger if exists trg_cip_logs_updated on public.cip_logs;
create trigger trg_cip_logs_updated before update on public.cip_logs
  for each row execute function public.set_updated_at();

alter table public.cip_logs enable row level security;
drop policy if exists "cip_logs authed" on public.cip_logs;
create policy "cip_logs authed" on public.cip_logs
  for all to authenticated using (true);

-- ============================================================
-- 5. content_calendar — social / blog / email scheduling
-- ============================================================
create table if not exists public.content_calendar (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  caption     text,
  channel     text,
  status      text default 'draft' check (status in ('draft','scheduled','published')),
  post_date   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_content_calendar_date on public.content_calendar(post_date);
drop trigger if exists trg_content_calendar_updated on public.content_calendar;
create trigger trg_content_calendar_updated before update on public.content_calendar
  for each row execute function public.set_updated_at();

alter table public.content_calendar enable row level security;
drop policy if exists "content_calendar authed" on public.content_calendar;
create policy "content_calendar authed" on public.content_calendar
  for all to authenticated using (true);

-- ============================================================
-- 6. defects — NCR / quality issue tracker
-- ============================================================
create table if not exists public.defects (
  id                uuid primary key default gen_random_uuid(),
  reported_at       timestamptz not null default now(),
  run_ref           text,
  category          text not null,
  severity          text check (severity in ('low','medium','high','critical')),
  status            text not null default 'open' check (status in ('open','investigating','contained','closed')),
  owner             text,
  description       text,
  root_cause        text,
  corrective_action text,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_defects_status on public.defects(status, reported_at desc);
drop trigger if exists trg_defects_updated on public.defects;
create trigger trg_defects_updated before update on public.defects
  for each row execute function public.set_updated_at();

alter table public.defects enable row level security;
drop policy if exists "defects authed" on public.defects;
create policy "defects authed" on public.defects
  for all to authenticated using (true);

-- ============================================================
-- 7. formulas — versioned client recipes
-- ============================================================
create table if not exists public.formulas (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  client_id           uuid references public.clients(id) on delete set null,
  client_name         text,
  version             integer not null default 1,
  ingredients         text,
  allergens           text[] default '{}',
  target_yield_cases  integer,
  batch_size_gal      numeric,
  ph_target           text,
  brix_target         text,
  status              text default 'draft' check (status in ('draft','benchtop','approved','archived')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_formulas_client  on public.formulas(client_id);
create index if not exists idx_formulas_updated on public.formulas(updated_at desc);
drop trigger if exists trg_formulas_updated on public.formulas;
create trigger trg_formulas_updated before update on public.formulas
  for each row execute function public.set_updated_at();

alter table public.formulas enable row level security;
drop policy if exists "formulas authed" on public.formulas;
create policy "formulas authed" on public.formulas
  for all to authenticated using (true);

-- ============================================================
-- 8. nps_responses — Net Promoter Score per client
-- ============================================================
create table if not exists public.nps_responses (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.clients(id) on delete set null,
  client_name   text,
  score         integer not null check (score between 0 and 10),
  comment       text,
  responded_at  timestamptz not null default now()
);
create index if not exists idx_nps_responded_at on public.nps_responses(responded_at desc);
create index if not exists idx_nps_client       on public.nps_responses(client_id);

alter table public.nps_responses enable row level security;
-- Customer-facing public NPS form writes via anon role
drop policy if exists "nps insert public" on public.nps_responses;
create policy "nps insert public" on public.nps_responses
  for insert to anon, authenticated with check (true);
drop policy if exists "nps read authed" on public.nps_responses;
create policy "nps read authed" on public.nps_responses
  for select to authenticated using (true);

-- ============================================================
-- 9. production_runs — operations kanban
-- ============================================================
create table if not exists public.production_runs (
  id              uuid primary key default gen_random_uuid(),
  run_name        text not null,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  format          text,
  cases           integer,
  stage           text default 'Discovery' check (stage in ('Discovery','Formulation','Sample','COA','Production','Ship')),
  scheduled_date  date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_production_runs_stage on public.production_runs(stage, scheduled_date);
create index if not exists idx_production_runs_client on public.production_runs(client_id);
drop trigger if exists trg_production_runs_updated on public.production_runs;
create trigger trg_production_runs_updated before update on public.production_runs
  for each row execute function public.set_updated_at();

alter table public.production_runs enable row level security;
drop policy if exists "production_runs authed" on public.production_runs;
create policy "production_runs authed" on public.production_runs
  for all to authenticated using (true);

-- ============================================================
-- 10. resources — public blog / guide library
-- ============================================================
create table if not exists public.resources (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  excerpt         text,
  url             text,
  tag             text,
  read_time_min   integer,
  published       boolean not null default false,
  display_order   integer default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_resources_published on public.resources(published, display_order);
drop trigger if exists trg_resources_updated on public.resources;
create trigger trg_resources_updated before update on public.resources
  for each row execute function public.set_updated_at();

alter table public.resources enable row level security;
drop policy if exists "resources read public" on public.resources;
create policy "resources read public" on public.resources
  for select to anon, authenticated using (published = true);
drop policy if exists "resources authed full" on public.resources;
create policy "resources authed full" on public.resources
  for all to authenticated using (true);

-- ============================================================
-- 11. sample_shipments — sample tracking
-- ============================================================
create table if not exists public.sample_shipments (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  kind            text,
  qty             integer default 1,
  shipped_date    date,
  carrier         text,
  tracking        text,
  follow_up_date  date,
  status          text default 'prepping' check (status in ('prepping','shipped','delivered','followup_sent','dead')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_samples_status   on public.sample_shipments(status, shipped_date desc);
create index if not exists idx_samples_client   on public.sample_shipments(client_id);
drop trigger if exists trg_samples_updated on public.sample_shipments;
create trigger trg_samples_updated before update on public.sample_shipments
  for each row execute function public.set_updated_at();

alter table public.sample_shipments enable row level security;
drop policy if exists "samples authed" on public.sample_shipments;
create policy "samples authed" on public.sample_shipments
  for all to authenticated using (true);

-- ============================================================
-- 12. trade_shows — booth ROI tracker
-- ============================================================
create table if not exists public.trade_shows (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  show_date     date,
  location      text,
  cost          numeric default 0,
  leads_count   integer default 0,
  deals_won     integer default 0,
  revenue       numeric default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_trade_shows_date on public.trade_shows(show_date desc);
drop trigger if exists trg_trade_shows_updated on public.trade_shows;
create trigger trg_trade_shows_updated before update on public.trade_shows
  for each row execute function public.set_updated_at();

alter table public.trade_shows enable row level security;
drop policy if exists "trade_shows admin" on public.trade_shows;
create policy "trade_shows admin" on public.trade_shows
  for all to authenticated using (
    exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ============================================================
-- 13. vendors — supplier directory
-- ============================================================
create table if not exists public.vendors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text,
  contact_name    text,
  email           text,
  phone           text,
  lead_time_days  integer,
  moq             text,
  payment_terms   text,
  coi_expires     date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_vendors_category on public.vendors(category);
create index if not exists idx_vendors_name     on public.vendors(name);
drop trigger if exists trg_vendors_updated on public.vendors;
create trigger trg_vendors_updated before update on public.vendors
  for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;
drop policy if exists "vendors authed" on public.vendors;
create policy "vendors authed" on public.vendors
  for all to authenticated using (true);

-- ============================================================
-- 14. yield_logs — actual vs forecast cases per run
-- ============================================================
create table if not exists public.yield_logs (
  id              uuid primary key default gen_random_uuid(),
  run_name        text,
  client_id       uuid references public.clients(id) on delete set null,
  client_name     text,
  planned_cases   integer not null default 0,
  actual_cases    integer not null default 0,
  completed_at    date,
  loss_reason     text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_yield_logs_completed on public.yield_logs(completed_at desc);
create index if not exists idx_yield_logs_client    on public.yield_logs(client_id);
drop trigger if exists trg_yield_logs_updated on public.yield_logs;
create trigger trg_yield_logs_updated before update on public.yield_logs
  for each row execute function public.set_updated_at();

alter table public.yield_logs enable row level security;
drop policy if exists "yield_logs authed" on public.yield_logs;
create policy "yield_logs authed" on public.yield_logs
  for all to authenticated using (true);

-- ============================================================
-- DONE — 14 tables created.
-- Verify with:
--   select tablename from pg_tables
--   where schemaname='public'
--     and tablename = any (array['audit_log','capacity','case_studies',
--       'cip_logs','content_calendar','defects','formulas','nps_responses',
--       'production_runs','resources','sample_shipments','trade_shows',
--       'vendors','yield_logs'])
--   order by tablename;
-- Should return 14 rows.
-- ============================================================
