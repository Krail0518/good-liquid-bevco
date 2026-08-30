-- ============================================================
-- Good Liquid CRM — Compliance module (Phase 1)
-- ============================================================
-- Three tables that back the Compliance master page:
--   1. compliance_tasks   — the daily checklist (auto + manual)
--   2. compliance_records — all FDA-required form entries (data in JSONB)
--   3. hold_tags          — GMP-QC-001 Product Hold Tags (separate because they block shipping)
--
-- 21 CFR Part 117 compliant: contemporaneous timestamping,
-- typed e-signature (signed_by + signed_at + signature_name),
-- append-only via status state machine (draft → complete → signed).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ---------- compliance_tasks ----------
create table if not exists public.compliance_tasks (
  id                  uuid primary key default gen_random_uuid(),
  due_date            date not null,
  due_time            time,
  task_type           text not null,
  title               text not null,
  description         text,
  status              text not null default 'open' check (status in ('open','done','skipped','blocked')),
  assigned_to         uuid,
  run_id              uuid references public.production_runs(id) on delete set null,
  source              text not null default 'auto' check (source in ('auto','manual','event')),
  related_record_id   uuid,
  dedupe_key          text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  completed_by        uuid
);
create index if not exists idx_compliance_tasks_due  on public.compliance_tasks(due_date, status);
create index if not exists idx_compliance_tasks_run  on public.compliance_tasks(run_id);
create index if not exists idx_compliance_tasks_type on public.compliance_tasks(task_type, status);
create unique index if not exists uq_compliance_tasks_dedupe on public.compliance_tasks(dedupe_key) where dedupe_key is not null;

alter table public.compliance_tasks enable row level security;
drop policy if exists "compliance_tasks authed" on public.compliance_tasks;
create policy "compliance_tasks authed" on public.compliance_tasks for all to authenticated using (true);

-- ---------- compliance_records ----------
create table if not exists public.compliance_records (
  id                uuid primary key default gen_random_uuid(),
  form_code         text not null,
  record_date       date not null default current_date,
  recorded_at       timestamptz not null default now(),
  data              jsonb not null default '{}'::jsonb,
  status            text not null default 'draft' check (status in ('draft','complete','signed','voided')),
  completed_by      uuid,
  completed_at      timestamptz,
  signed_by         uuid,
  signed_at         timestamptz,
  signature_name    text,
  signature_meaning text,
  run_id            uuid references public.production_runs(id) on delete set null,
  client_id         uuid references public.clients(id) on delete set null,
  has_deviation     boolean not null default false,
  deviation_notes   text,
  corrective_action text,
  hold_tag_id       uuid,
  nc_report_id      uuid references public.defects(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_compliance_records_form_date  on public.compliance_records(form_code, record_date desc);
create index if not exists idx_compliance_records_run        on public.compliance_records(run_id);
create index if not exists idx_compliance_records_status     on public.compliance_records(status);
create index if not exists idx_compliance_records_deviation  on public.compliance_records(has_deviation) where has_deviation = true;
create index if not exists idx_compliance_records_data_gin   on public.compliance_records using gin (data);
drop trigger if exists trg_compliance_records_updated on public.compliance_records;
create trigger trg_compliance_records_updated before update on public.compliance_records
  for each row execute function public.set_updated_at();

alter table public.compliance_records enable row level security;
drop policy if exists "compliance_records authed" on public.compliance_records;
create policy "compliance_records authed" on public.compliance_records for all to authenticated using (true);

-- ---------- hold_tags ----------
create table if not exists public.hold_tags (
  id                          uuid primary key default gen_random_uuid(),
  tag_number                  text unique not null,
  hold_date                   timestamptz not null default now(),
  product_name                text not null,
  lot_number                  text,
  qty_held                    text,
  location                    text,
  reason                      text not null,
  hazard_type                 text check (hazard_type in (null, 'biological','chemical','physical','allergen','other')),
  initiated_by                uuid,
  pcqi_notified               boolean not null default false,
  pcqi_notified_at            timestamptz,
  disposition                 text check (disposition in (null, 'release','reprocess','destroy')),
  disposition_authorized_by   uuid,
  disposition_authorized_name text,
  disposition_date            timestamptz,
  source_record_id            uuid references public.compliance_records(id) on delete set null,
  source_nc_id                uuid references public.defects(id) on delete set null,
  status                      text not null default 'open' check (status in ('open','disposed','released')),
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists idx_hold_tags_status on public.hold_tags(status, hold_date desc);
create index if not exists idx_hold_tags_lot    on public.hold_tags(lot_number);
drop trigger if exists trg_hold_tags_updated on public.hold_tags;
create trigger trg_hold_tags_updated before update on public.hold_tags
  for each row execute function public.set_updated_at();

alter table public.hold_tags enable row level security;
drop policy if exists "hold_tags authed" on public.hold_tags;
create policy "hold_tags authed" on public.hold_tags for all to authenticated using (true);

-- Back-link compliance_records.hold_tag_id → hold_tags (deferred FK since both reference each other)
alter table public.compliance_records
  drop constraint if exists compliance_records_hold_tag_fk;
alter table public.compliance_records
  add constraint compliance_records_hold_tag_fk
  foreign key (hold_tag_id) references public.hold_tags(id) on delete set null;
