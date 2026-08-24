-- ════════════════════════════════════════════════════════════════
-- Can catalog by size — blank/brite, shrink-sleeve label, pre-printed
-- ════════════════════════════════════════════════════════════════
-- Replaces the three generic can rows with size-specific ones so the quote
-- builder can price the can/label for the exact format being quoted. All values
-- are placeholders (flagged) — Mike sets the real numbers in "💲 Prices".
--
-- ROLLBACK:
--   delete from public.pricing_settings where key like 'can_blank_%'
--     or key like 'can_shrink_1%' or key = 'can_printed_12_per_unit';
--   -- (re-insert the generic can_blank/shrink/printed rows from history if needed)

delete from public.pricing_settings
 where key in ('can_blank_per_unit','can_shrink_label_per_unit','can_printed_per_unit');

insert into public.pricing_settings (key, category, label, unit, value, sort_order) values
  -- Blank / brite cans
  ('can_blank_12std_per_unit',    'Cans', 'Blank / Brite Can — 12oz Standard', 'per can', 0.18, 230),
  ('can_blank_12sleek_per_unit',  'Cans', 'Blank / Brite Can — 12oz Sleek',    'per can', 0.20, 231),
  ('can_blank_16std_per_unit',    'Cans', 'Blank / Brite Can — 16oz Standard', 'per can', 0.22, 232),
  ('can_blank_192_per_unit',      'Cans', 'Blank / Brite Can — 19.2oz',        'per can', 0.30, 233),
  -- Shrink-sleeve labels
  ('can_shrink_12std_per_unit',   'Cans', 'Shrink-Sleeve Label — 12oz Standard','per can', 0.10, 234),
  ('can_shrink_12sleek_per_unit', 'Cans', 'Shrink-Sleeve Label — 12oz Sleek',   'per can', 0.12, 235),
  ('can_shrink_16_per_unit',      'Cans', 'Shrink-Sleeve Label — 16oz',         'per can', 0.12, 236),
  -- Pre-printed cans
  ('can_printed_12_per_unit',     'Cans', 'Pre-Printed Can — 12oz',            'per can', 0.32, 237)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
