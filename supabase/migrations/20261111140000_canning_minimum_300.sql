-- Canning minimum raised to 300 cases per flavor (Nov 11, 2026)
--
-- Mike switched the per flavor minimum from 200 cases (4,800 cans) to
-- 300 cases (7,200 cans). The first band of the canning ladder now starts at
-- 300 and the CRM minimum setting follows. Prices are unchanged; a run below
-- the first band still falls back to the first band's price in both lookups.
-- Applied to production on Nov 11, 2026 and recorded here.
--
-- ROLLBACK: update public.canning_rates set min_cases = 200 where min_cases = 300;
--           update public.pricing_settings set value = '200' where key = 'moq_cases';

update public.canning_rates
   set min_cases = 300, updated_at = now()
 where min_cases = 200;

update public.pricing_settings
   set value = '300', updated_at = now()
 where key = 'moq_cases';
