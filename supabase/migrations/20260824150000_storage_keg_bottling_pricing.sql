-- ════════════════════════════════════════════════════════════════
-- More pricing_settings: storage, keg minimum, MOQ, bottling packaging
-- ════════════════════════════════════════════════════════════════
-- Adds the remaining editable prices/quantities the quote builder needs:
--   • Storage — $15 per pallet per month, $1,500/month minimum (Mike's numbers)
--   • Keg minimum order — set to 40 kegs (Mike said 40; the deck said 50 —
--     flagged for confirmation in chat)
--   • Canning MOQ — 200 cases (adjustable)
--   • Bottling packaging — pallet + pallet-wrap already apply; adds a 6-pack
--     bottle case/carrier line and a bottling cases-per-pallet setting so
--     bottled jobs can be quoted with packaging like canning. The two bottling
--     packaging values are placeholders (flagged) for Mike to set in "💲 Prices".
--
-- Also splits the single "Estimated Can Cost" into the three can types Mike
-- quotes: blank/brite, shrink-sleeve labeled, and pre-printed. Values are
-- deck-informed placeholders ($0.29-0.35/unit range) — flagged for Mike to set
-- the exact numbers in the "💲 Prices" editor.
--
-- ROLLBACK:
--   delete from public.pricing_settings where key in (
--     'storage_per_pallet_month','storage_monthly_minimum','keg_minimum',
--     'moq_cases','bottling_case_6pack_per_case','bottling_cases_per_pallet',
--     'can_blank_per_unit','can_shrink_label_per_unit','can_printed_per_unit');
--   -- (and re-insert 'can_cost_per_unit' from history if needed)

-- Replace the coarse single can-cost row with the three specific can types.
delete from public.pricing_settings where key = 'can_cost_per_unit';

insert into public.pricing_settings (key, category, label, unit, value, sort_order) values
  ('storage_per_pallet_month',    'Storage',            'Storage — per pallet / month', 'per pallet/mo', 15,   200),
  ('storage_monthly_minimum',     'Storage',            'Storage — monthly minimum',    'per month',     1500, 201),
  ('keg_minimum',                 'Keg',                'Keg Minimum Order',            'kegs',          40,   95),
  ('moq_cases',                   'Minimums',           'Canning Minimum Order',        'cases',         200,  210),
  ('bottling_case_6pack_per_case','Bottling packaging', '6-pack Bottle Case / Carrier', 'per case',      0.75, 220),
  ('bottling_cases_per_pallet',   'Bottling packaging', 'Bottling Cases per Pallet',    'cases',         45,   221),
  ('can_blank_per_unit',          'Cans',               'Blank / Brite Can',            'per can',       0.30, 230),
  ('can_shrink_label_per_unit',   'Cans',               'Shrink-Sleeve Label',          'per can',       0.15, 231),
  ('can_printed_per_unit',        'Cans',               'Pre-Printed Can',              'per can',       0.33, 232)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
