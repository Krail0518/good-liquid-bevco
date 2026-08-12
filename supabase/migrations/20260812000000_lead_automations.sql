-- ── Lead automation layer: SLA watchdog, auto follow-ups, one-tap actions ─────
-- 2026-08-12
--
-- Adds the state the automation function and the CRM need so a lead can't sit
-- ignored:
--   deals.first_response_at  — when we first replied to the lead (for the SLA)
--   deals.sla_alerted_at     — when we escalated an unanswered lead (dedupe alerts)
--   deals.snoozed_until      — Mike snoozed this lead; automations skip it until then
--   deals.handled_at         — Mike marked it handled; automations leave it alone
--   lead_followups           — queue of AI-drafted follow-ups awaiting one-tap send
--
-- Staff-only, same posture as ai_briefs / deal_documents: is_gl_staff() may read
-- and write; the viewer role may read but not mutate; the tenant guard keeps the
-- table off-limits to portal customers entirely (no client access path here).
--
-- ROLLBACK:
--   drop table if exists public.lead_followups;
--   alter table public.deals
--     drop column if exists first_response_at,
--     drop column if exists sla_alerted_at,
--     drop column if exists snoozed_until,
--     drop column if exists handled_at;

alter table public.deals
  add column if not exists first_response_at timestamptz,
  add column if not exists sla_alerted_at    timestamptz,
  add column if not exists snoozed_until      timestamptz,
  add column if not exists handled_at         timestamptz;

create table if not exists public.lead_followups (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references public.deals(id)   on delete cascade,
  client_id   uuid references public.clients(id) on delete cascade,
  to_email    text,
  to_name     text,
  subject     text,
  body        text,
  reason      text,        -- why it was generated, e.g. "no reply in 5 days"
  status      text not null default 'ready',   -- ready | sent | dismissed
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  sent_at     timestamptz
);

create index if not exists idx_lead_followups_deal   on public.lead_followups(deal_id);
create index if not exists idx_lead_followups_status on public.lead_followups(status);

alter table public.lead_followups enable row level security;

-- Staff read/write.
drop policy if exists "lead_followups staff all" on public.lead_followups;
create policy "lead_followups staff all" on public.lead_followups
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

-- Viewers (read-only staff) may read but not mutate. Per-command restrictive
-- policies so SELECT stays open to them (mirrors deal_documents).
drop policy if exists "lead_followups viewer no insert" on public.lead_followups;
create policy "lead_followups viewer no insert" on public.lead_followups
  as restrictive for insert to authenticated
  with check (not public.gl_is_viewer());
drop policy if exists "lead_followups viewer no update" on public.lead_followups;
create policy "lead_followups viewer no update" on public.lead_followups
  as restrictive for update to authenticated
  using (not public.gl_is_viewer()) with check (not public.gl_is_viewer());
drop policy if exists "lead_followups viewer no delete" on public.lead_followups;
create policy "lead_followups viewer no delete" on public.lead_followups
  as restrictive for delete to authenticated
  using (not public.gl_is_viewer());

notify pgrst, 'reload schema';
