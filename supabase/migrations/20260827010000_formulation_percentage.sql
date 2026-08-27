-- ════════════════════════════════════════════════════════════════
-- Formulation kickback percentage — what Mike earns on a referral
-- ════════════════════════════════════════════════════════════════
-- 20260827000000 recorded that formulation happened, which house did it, and
-- what the brand spent. This adds the cut Mike takes on that spend, so the
-- dashboard can total the revenue those referrals actually generate:
--
--   revenue = formulation_spend * formulation_pct / 100
--
-- Stored as the percentage rather than the computed dollar figure: the rate is
-- the fact Mike negotiates and remembers, and deriving the money keeps the two
-- from drifting apart when a spend is corrected.
--
-- numeric(5,2) with a 0–100 CHECK: a rate, not a multiplier. NULL means "not
-- set yet", which the dashboard reports separately from a genuine 0% — an
-- unset rate is a missing fact, and silently treating it as zero would
-- understate revenue with no sign that anything was missing.
--
-- ROLLBACK:
--   alter table public.deals   drop column if exists formulation_pct;
--   alter table public.clients drop column if exists formulation_pct;

alter table public.deals   add column if not exists formulation_pct numeric(5,2);
alter table public.clients add column if not exists formulation_pct numeric(5,2);

alter table public.deals   drop constraint if exists deals_formulation_pct_range;
alter table public.clients drop constraint if exists clients_formulation_pct_range;
alter table public.deals
  add constraint deals_formulation_pct_range
  check (formulation_pct is null or (formulation_pct >= 0 and formulation_pct <= 100));
alter table public.clients
  add constraint clients_formulation_pct_range
  check (formulation_pct is null or (formulation_pct >= 0 and formulation_pct <= 100));

notify pgrst, 'reload schema';
