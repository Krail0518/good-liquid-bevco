-- ============================================================
-- Phase 3 Wave 1 — GMP task scheduler + mock recall / traceability
-- ============================================================
-- Two capabilities layered onto the existing GMP/compliance data model:
--
--   1. A SCHEDULER driven by data, not code. gmp_task_defs holds the
--      recurring GMP task definitions (pre-op, hygiene, CCP, seam,
--      label, receiving, master sanitation…) with a frequency and
--      timing so the app can render "what's due today / this run" and
--      link each task to its GMP form_code (see gmp_templates). Adding
--      or retiring a scheduled task is a row edit, never a deploy.
--
--   2. LOT TRACEABILITY + RECALL EXERCISES. lot_inputs captures what
--      went INTO a lot (backward trace: material, supplier, supplier
--      lot, received record) and lot_shipments captures where a lot
--      WENT (forward trace: customer, quantity, ship date, PO). Both
--      hang off production_runs. mock_recalls logs recall drills —
--      units produced vs. accounted, % reconciled, time-to-complete —
--      so the plant can demonstrate a defensible, timed mock recall to
--      an auditor.
--
-- RLS mirrors gmp_templates: staff (authenticated) get full access;
-- inspectors (anon holding a valid X-Inspector-Token) get read-only.
-- Writes stay locked to staff on every table here.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Recurring GMP task definitions (scheduler source) ─────
create table if not exists public.gmp_task_defs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  task_type   text not null,                 -- preop|hygiene|ccp|seam|label|receiving|sanitation…
  frequency   text not null,                 -- per_run|daily|weekly|monthly|annual|as_needed
  due_time    time,                          -- clock time the task is expected by (nullable)
  weekday     integer,                        -- 0-6 for weekly tasks (nullable)
  form_code   text,                          -- links to public.gmp_templates(form_code)
  category    text,
  active      boolean not null default true,
  sort_order  integer default 100,
  created_at  timestamptz not null default now()
);

-- ── (2) Lot inputs — backward trace (what went INTO a lot) ────
create table if not exists public.lot_inputs (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid references public.production_runs(id) on delete cascade,
  lot_code            text,
  material            text not null,
  supplier            text,
  supplier_lot        text,
  quantity            numeric,
  uom                 text,
  received_record_id  uuid,
  created_at          timestamptz not null default now()
);

-- ── (3) Lot shipments — forward trace (where a lot WENT) ───────
create table if not exists public.lot_shipments (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references public.production_runs(id) on delete cascade,
  lot_code    text,
  customer    text not null,
  quantity    numeric,
  uom         text,
  ship_date   date,
  po          text,
  created_at  timestamptz not null default now()
);

-- ── (4) Mock recalls — recall-exercise log ────────────────────
create table if not exists public.mock_recalls (
  id                uuid primary key default gen_random_uuid(),
  lot_code          text not null,
  run_id            uuid references public.production_runs(id) on delete set null,
  initiated_at      timestamptz not null default now(),
  completed_at      timestamptz,
  units_produced    numeric,
  units_accounted   numeric,
  pct_reconciled    numeric,
  time_to_complete  text,
  conducted_by      text,
  passed            boolean,
  notes             text,
  created_at        timestamptz not null default now()
);

-- ── (5) Indexes ───────────────────────────────────────────────
create index if not exists idx_lot_inputs_run on public.lot_inputs(run_id);
create index if not exists idx_lot_shipments_run on public.lot_shipments(run_id);
create index if not exists idx_mock_recalls_lot on public.mock_recalls(lot_code);
create index if not exists idx_gmp_task_defs_active on public.gmp_task_defs(active, sort_order);

-- ── (6) RLS — staff full, inspector read (mirrors gmp_templates) ──
alter table public.gmp_task_defs enable row level security;

drop policy if exists "gmp_task_defs staff all" on public.gmp_task_defs;
create policy "gmp_task_defs staff all" on public.gmp_task_defs
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "gmp_task_defs inspector read" on public.gmp_task_defs;
create policy "gmp_task_defs inspector read" on public.gmp_task_defs
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

alter table public.lot_inputs enable row level security;

drop policy if exists "lot_inputs staff all" on public.lot_inputs;
create policy "lot_inputs staff all" on public.lot_inputs
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "lot_inputs inspector read" on public.lot_inputs;
create policy "lot_inputs inspector read" on public.lot_inputs
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

alter table public.lot_shipments enable row level security;

drop policy if exists "lot_shipments staff all" on public.lot_shipments;
create policy "lot_shipments staff all" on public.lot_shipments
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "lot_shipments inspector read" on public.lot_shipments;
create policy "lot_shipments inspector read" on public.lot_shipments
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

alter table public.mock_recalls enable row level security;

drop policy if exists "mock_recalls staff all" on public.mock_recalls;
create policy "mock_recalls staff all" on public.mock_recalls
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "mock_recalls inspector read" on public.mock_recalls;
create policy "mock_recalls inspector read" on public.mock_recalls
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- ── (7) Seed the scheduler task definitions (idempotent) ──────
-- Only seed when the table is empty, so re-runs never duplicate rows.
insert into public.gmp_task_defs (title, task_type, frequency, due_time, form_code, category, sort_order)
select *
from (values
  ('Pre-op sanitation verification', 'preop', 'per_run', time '06:00', 'GMP-PREOP-001', 'sanitation', 10),
  ('Daily GMP & hygiene check', 'hygiene', 'daily', time '07:00', 'GMP-HYGIENE-001', 'hygiene', 20),
  ('CCP — pasteurizer monitoring', 'ccp', 'per_run', null, 'GMP-CCP-PAST-001', 'ccp', 30),
  ('Double-seam inspection', 'seam', 'per_run', null, 'GMP-SEAM-001', 'seam', 40),
  ('Label reconciliation', 'label', 'per_run', null, 'GMP-LABEL-001', 'label', 50),
  ('Receiving inspection', 'receiving', 'as_needed', null, 'GMP-RECV-001', 'receiving', 60),
  ('Master sanitation — walls/overheads', 'sanitation', 'weekly', null, null, 'sanitation', 70),
  ('Master sanitation — drains', 'sanitation', 'weekly', null, null, 'sanitation', 75)
) as seed(title, task_type, frequency, due_time, form_code, category, sort_order)
where not exists (select 1 from public.gmp_task_defs limit 1);

notify pgrst, 'reload schema';
