-- ROLLBACK:
--   update public.pricing_settings set value = 45 where key = 'bottling_cases_per_pallet';
--
-- ALREADY APPLIED (see the note in 20260824150000). Corrects the value seeded
-- by 20260824150000 from 45 to the real 50.

-- Set bottling cases-per-pallet to 50 (Mike's number). ROLLBACK: n/a.
update public.pricing_settings set value = 50, updated_at = now()
 where key = 'bottling_cases_per_pallet';
notify pgrst, 'reload schema';
