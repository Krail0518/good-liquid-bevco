-- ROLLBACK:
--   update public.pricing_settings
--      set key = 'bottling_cases_per_pallet', label = 'Bottling Cases per Pallet',
--          unit = 'cases', value = 50, updated_at = now()
--    where key = 'bottling_bottles_per_pallet';
--   (and revert the quote builder / invoice code that reads the new key)
--
-- Bottling pallets by bottles, not cases
-- ══════════════════════════════════════
-- "Bottling Cases per Pallet" was one number (50) for both case sizes, but a
-- 12-bottle case takes twice the room of a 6-bottle case. The real limit is
-- 792 bottles a pallet: 66 cases of 12 or 132 cases of 6. The quote builder
-- and the invoice builder now read bottling_bottles_per_pallet and work out
-- cases per pallet from each line's case size.
--
-- The row is renamed in place (same id) rather than deleted and re-inserted.

update public.pricing_settings
   set key = 'bottling_bottles_per_pallet',
       label = 'Bottles per Pallet (750ml)',
       unit = 'bottles',
       value = 792,
       updated_at = now()
 where key = 'bottling_cases_per_pallet';

insert into public.pricing_settings (key, category, label, unit, value, sort_order)
select 'bottling_bottles_per_pallet', 'Bottling packaging', 'Bottles per Pallet (750ml)', 'bottles', 792, 221
where not exists (select 1 from public.pricing_settings where key = 'bottling_bottles_per_pallet');
