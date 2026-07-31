-- ============================================================
-- Phase 3 Wave 2 — Training records + Internal audit / Management review
-- ============================================================
-- Rounds out the SQF management system with the three pillars an
-- auditor expects beyond day-to-day GMP execution:
--
--   1. TRAINING & COMPETENCY. training_records tracks who was
--      trained on what, when it was completed, and when it expires —
--      so the plant can prove every operator holding a role has
--      current, documented competency (HACCP, GMP, allergen,
--      chemical handling…). Expiry drives "who's due for refresher".
--
--   2. INTERNAL AUDITS. internal_audits are the plant's own
--      scheduled SQF self-audits (planned → in_progress → closed).
--      audit_findings are the non-conformances raised during an
--      audit, each optionally escalated to a corrective-action /
--      NCR record (public.defects) for tracked follow-through.
--
--   3. MANAGEMENT REVIEW. management_reviews logs the periodic
--      management-review meetings — attendees, KPIs reviewed
--      (stored as jsonb for flexible metric sets), discussion notes
--      and agreed actions — closing the continuous-improvement loop.
--
-- RLS mirrors Wave 1 / gmp_templates: staff (authenticated) get full
-- access; inspectors (anon holding a valid X-Inspector-Token) get
-- read-only. Writes stay locked to staff on every table here.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Training records — employee training / competency ─────
create table if not exists public.training_records (
  id              uuid primary key default gen_random_uuid(),
  employee_name   text not null,
  role            text,
  course          text not null,
  completed_date  date,
  expires_date    date,
  trainer         text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ── (2) Internal audits — scheduled internal SQF audits ───────
create table if not exists public.internal_audits (
  id          uuid primary key default gen_random_uuid(),
  audit_date  date,
  scope       text,
  auditor     text,
  status      text not null default 'planned'
                check (status in ('planned','in_progress','closed')),
  summary     text,
  created_at  timestamptz not null default now()
);

-- ── (3) Audit findings — non-conformances raised in an audit ──
create table if not exists public.audit_findings (
  id           uuid primary key default gen_random_uuid(),
  audit_id     uuid references public.internal_audits(id) on delete cascade,
  clause       text,
  description  text not null,
  severity     text,
  status       text not null default 'open',
  ncr_id       uuid references public.defects(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ── (4) Management reviews — management-review meetings ────────
create table if not exists public.management_reviews (
  id           uuid primary key default gen_random_uuid(),
  review_date  date,
  attendees    text,
  kpis         jsonb,
  notes        text,
  actions      text,
  created_at   timestamptz not null default now()
);

-- ── (5) Indexes ───────────────────────────────────────────────
create index if not exists idx_training_expires on public.training_records(expires_date);
create index if not exists idx_audit_findings_audit on public.audit_findings(audit_id);
create index if not exists idx_internal_audits_date on public.internal_audits(audit_date);

-- ── (6) RLS — staff full, inspector read (mirrors gmp_templates) ──
alter table public.training_records enable row level security;

drop policy if exists "training_records staff all" on public.training_records;
create policy "training_records staff all" on public.training_records
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "training_records inspector read" on public.training_records;
create policy "training_records inspector read" on public.training_records
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

alter table public.internal_audits enable row level security;

drop policy if exists "internal_audits staff all" on public.internal_audits;
create policy "internal_audits staff all" on public.internal_audits
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "internal_audits inspector read" on public.internal_audits;
create policy "internal_audits inspector read" on public.internal_audits
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

alter table public.audit_findings enable row level security;

drop policy if exists "audit_findings staff all" on public.audit_findings;
create policy "audit_findings staff all" on public.audit_findings
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "audit_findings inspector read" on public.audit_findings;
create policy "audit_findings inspector read" on public.audit_findings
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

alter table public.management_reviews enable row level security;

drop policy if exists "management_reviews staff all" on public.management_reviews;
create policy "management_reviews staff all" on public.management_reviews
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "management_reviews inspector read" on public.management_reviews;
create policy "management_reviews inspector read" on public.management_reviews
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

notify pgrst, 'reload schema';
