-- ════════════════════════════════════════════════════════════════
-- Force canning_rates / bottling_rates to the Aug 2026 deck ladder
-- ════════════════════════════════════════════════════════════════
-- The quote builder already uses deck-correct tier values, but the INVOICE
-- builder reads these two tables, and they could not be read from the assistant
-- sandbox to verify. This overwrites the per-unit prices to the deck values.
--
-- Written to be safe WITHOUT knowing the exact stored labels or keys:
--   • Canning: prices set by min_cases BAND, split 12oz vs 16oz by a substring
--     match on format. 12oz Standard and 12oz Sleek share one ladder (identical
--     on the deck), so matching "%12%" is correct for both. Robust to the
--     old 150-case minimum vs the new 200 (the lowest band catches either).
--   • Bottling: prices set by tier RANK (ascending min_units), so it works
--     whether min_units is stored in cases or bottles, and whatever the exact
--     thresholds are. Assumes the standard 5-tier ladder.
-- Only existing rows are touched — no inserts, so no risk of duplicate tiers.
--
-- Deck ladder:
--   12oz $/can: 0.48 / 0.43 / 0.38 / 0.35 / 0.31 / 0.28  (200-339 … 5000+)
--   16oz $/can: 0.58 / 0.53 / 0.48 / 0.45 / 0.41 / 0.38
--   750ml $/btl: 2.16 / 1.91 / 1.58 / 1.41 / 1.12         (220 … 5280 cases)
--
-- ROLLBACK: prices are overwritten in place; there is no automatic restore.
-- Prior values can be re-entered from the CRM "$ Pricing" screen if needed.

-- ── Canning: 12oz ladder (Standard + Sleek share it) ────────────────────────
update public.canning_rates set price_per_can = case
    when min_cases < 340  then 0.48
    when min_cases < 501  then 0.43
    when min_cases < 1000 then 0.38
    when min_cases < 2500 then 0.35
    when min_cases < 5000 then 0.31
    else 0.28
  end,
  updated_at = now()
where format ilike '%12%';

-- ── Canning: 16oz ladder ────────────────────────────────────────────────────
update public.canning_rates set price_per_can = case
    when min_cases < 340  then 0.58
    when min_cases < 501  then 0.53
    when min_cases < 1000 then 0.48
    when min_cases < 2500 then 0.45
    when min_cases < 5000 then 0.41
    else 0.38
  end,
  updated_at = now()
where format ilike '%16%';

-- ── Bottling: 750ml ladder, mapped by ascending tier rank ───────────────────
with ranked as (
  select id, row_number() over (order by min_units) as rn
  from public.bottling_rates
)
update public.bottling_rates b
   set price_per_unit = (array[2.16, 1.91, 1.58, 1.41, 1.12])[least(r.rn, 5)],
       updated_at = now()
  from ranked r
 where b.id = r.id;

notify pgrst, 'reload schema';
