-- ============================================================
-- Add win-loss outcome fields to deals
-- ============================================================
-- When a deal moves to Closed Won / Closed Lost, fix.js prompts
-- for an outcome reason + value + notes (see openWinLossAnalytics
-- and the saveDealDetail wrapper). It then writes:
--     update deals set outcome_reason, outcome_value,
--                      outcome_notes, closed_at where id = ...
-- and queries:
--     select * from deals where stage in ('Closed Won','Closed Lost')
--     order by closed_at desc
--
-- None of these four columns existed on deals — so every outcome
-- write silently 404'd (PGRST204) and the Win-Loss Analytics modal
-- always fell back to the localStorage cache. This migration adds
-- the columns and an index on closed_at so the order-by has an
-- index to use.
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.deals
  add column if not exists outcome_reason text,
  add column if not exists outcome_value  numeric,
  add column if not exists outcome_notes  text,
  add column if not exists closed_at      timestamptz;

create index if not exists idx_deals_closed_at
  on public.deals(closed_at desc nulls last);

create index if not exists idx_deals_stage_closed
  on public.deals(stage, closed_at desc);

comment on column public.deals.outcome_reason is
  'Reason captured when a deal moved to Closed Won/Lost (e.g. "Price", "Timing", "Wrong fit"). NULL for deals still in flight.';
comment on column public.deals.outcome_value is
  'Final realized value at close. May differ from value (the forecast) — e.g. discounted, partial win.';
comment on column public.deals.closed_at is
  'When the deal moved into Closed Won/Lost. NULL while still in flight. Drives the Win-Loss Analytics ordering.';

notify pgrst, 'reload schema';
