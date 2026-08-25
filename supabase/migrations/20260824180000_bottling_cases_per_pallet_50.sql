-- Set bottling cases-per-pallet to 50 (Mike's number). ROLLBACK: n/a.
update public.pricing_settings set value = 50, updated_at = now()
 where key = 'bottling_cases_per_pallet';
notify pgrst, 'reload schema';
