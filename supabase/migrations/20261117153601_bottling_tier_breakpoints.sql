-- ROLLBACK:
--   update public.bottling_rates set min_units = 1    where id = 1;
--   update public.bottling_rates set min_units = 500  where id = 2;
--   update public.bottling_rates set min_units = 1000 where id = 3;
--   update public.bottling_rates set min_units = 5000 where id = 4;
--   delete from public.bottling_rates where format = '750ml' and min_units = 31680;
--
-- Fix the 750ml bottling tier breakpoints
-- ════════════════════════════════════════
-- The invoice builder prices bottling from bottling_rates. Production held
-- placeholder breakpoints (1 / 500 / 1,000 / 5,000 bottles) and only four
-- tiers. 20260824130000_sync_tier_rates_to_deck.sql rewrote the PRICES to the
-- deck ladder by rank but never touched min_units, so 1,000 bottles landed on
-- the $1.58 tier, which the published ladder reserves for 7,920+ bottles.
--
-- Published ladder (index.html, quote builder, assistant prompt):
--   1,320–3,959 = $2.16 · 3,960–7,919 = $1.91 · 7,920–15,839 = $1.58
--   15,840–31,679 = $1.41 · 31,680+ = $1.12
-- Quantities below the 1,320 minimum fall back to the first tier ($2.16),
-- which is what the invoice builder already does for anything under tier 1.

update public.bottling_rates set min_units = 1320,  price_per_unit = 2.16, updated_at = now() where id = 1;
update public.bottling_rates set min_units = 3960,  price_per_unit = 1.91, updated_at = now() where id = 2;
update public.bottling_rates set min_units = 7920,  price_per_unit = 1.58, updated_at = now() where id = 3;
update public.bottling_rates set min_units = 15840, price_per_unit = 1.41, updated_at = now() where id = 4;

insert into public.bottling_rates (format, format_label, min_units, price_per_unit)
select '750ml', '750ml Bottle', 31680, 1.12
where not exists (
  select 1 from public.bottling_rates where format = '750ml' and min_units = 31680
);

notify pgrst, 'reload schema';
