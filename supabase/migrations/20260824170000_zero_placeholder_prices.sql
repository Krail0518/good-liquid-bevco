-- ════════════════════════════════════════════════════════════════
-- Zero out the estimated placeholder prices
-- ════════════════════════════════════════════════════════════════
-- Per Mike: any price the assistant estimated (rather than got from Mike or the
-- deck) should be 0 so it's obviously unset, and he'll fill in the real number
-- in the "💲 Prices" editor. This zeroes only those estimated rows; confirmed
-- values (trays $0.50, pallet $12, wrap $8, nitrogen $0.03, keg $12/$17.50,
-- R&D/IP/benchtop, bottling label add-ons, storage, etc.) are untouched.
--
-- ROLLBACK: none needed — these were placeholders; Mike sets real values.

update public.pricing_settings set value = 0, updated_at = now()
 where key in (
   'case_tray_shrinkwrap_per_case',
   'paktech_4pack_per_can', 'paktech_6pack_per_can',
   'proper_pack_4pack_per_can', 'proper_pack_6pack_per_can',
   'bottling_case_6pack_per_case',
   'can_blank_12std_per_unit', 'can_blank_12sleek_per_unit',
   'can_blank_16std_per_unit', 'can_blank_192_per_unit',
   'can_shrink_12std_per_unit', 'can_shrink_12sleek_per_unit', 'can_shrink_16_per_unit',
   'can_printed_12_per_unit'
 );

notify pgrst, 'reload schema';
