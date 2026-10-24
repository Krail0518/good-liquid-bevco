-- Canning tier ladder starts at 200 cases (Oct 24, 2026)
--
-- The minimum order has been 200 cases per flavor since Aug 19, 2026, and the
-- deck's first band reads "200 to 339". The ladder's first rows still said 150
-- from the grandfather period. Mike confirmed no client is grandfathered at
-- 150 anymore. Rates below the first tier already fall back to the first
-- tier's price in both lookups, so nothing prices at zero.
--
-- ROLLBACK: update public.canning_rates set min_cases = 150 where min_cases = 200;

update public.canning_rates
   set min_cases = 200, updated_at = now()
 where min_cases = 150;
