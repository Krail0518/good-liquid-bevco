-- ============================================================
-- Migrate three localStorage stores to proper Supabase tables
-- ============================================================
--   gl_followup_log         → public.followup_log
--   gl_weekly_ack           → public.compliance_acks
--   gl_waive_surcharge_<id> → public.invoices.waive_card_surcharge
--
-- Source-of-truth fix: these were per-device localStorage, so two
-- staff users on different laptops saw different state. Per Mike's
-- "store everything in DB" rule.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── followup_log: who/when sent which follow-up on which invoice ─────────
create table if not exists public.followup_log (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid references public.invoices(id) on delete cascade,
  invoice_number text,
  sent_at       timestamptz not null default now(),
  sent_by       uuid,
  kind          text not null default 'manual',  -- 'manual' | 'auto' | 'gentle' | 'firm'
  sent          boolean not null default true,   -- false if email send itself failed
  cc_count      integer not null default 0,
  notes         text                              -- subject line or short summary
);
create index if not exists idx_followup_log_invoice on public.followup_log(invoice_id, sent_at desc);
create index if not exists idx_followup_log_number  on public.followup_log(invoice_number, sent_at desc);

alter table public.followup_log enable row level security;
drop policy if exists "followup_log staff all" on public.followup_log;
create policy "followup_log staff all" on public.followup_log
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── compliance_acks: weekly review PCQI acknowledgments ──────────────────
create table if not exists public.compliance_acks (
  record_id  uuid primary key,
  acked_at   timestamptz not null default now(),
  acked_by   uuid
);
alter table public.compliance_acks enable row level security;
drop policy if exists "compliance_acks staff all" on public.compliance_acks;
create policy "compliance_acks staff all" on public.compliance_acks
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── invoices.waive_card_surcharge: per-invoice fee waiver flag ───────────
alter table public.invoices
  add column if not exists waive_card_surcharge boolean not null default false;

notify pgrst, 'reload schema';
