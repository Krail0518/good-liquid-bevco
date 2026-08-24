-- ════════════════════════════════════════════════════════════════
-- Expand pricing_settings into a full packaging catalog
-- ════════════════════════════════════════════════════════════════
-- The quote builder needs every packaging option as its own editable price so
-- it can quote real jobs. Replaces the two coarse rows (a generic "case tray"
-- and a combined "case erector + shrink wrap") with itemized lines:
--   • 12-count and 24-count case trays, priced separately
--   • shrink-wrapping a case tray (its own material/labor line)
--   • PakTech handles — 4-pack and 6-pack
--   • eco-friendly molded-fiber can carriers — 4-pack and 6-pack
--   • an editable estimated can cost (pass-through)
--
-- Values: confirmed ones from Mike / the Aug deck; the rest seeded from the
-- deck's $0.05–0.06/can carrier estimate or a clearly-flagged placeholder that
-- Mike sets in the "💲 Prices" editor. Nothing here is a hidden guess.
--
-- ROLLBACK:
--   delete from public.pricing_settings where key in (
--     'case_tray_12_per_case','case_tray_24_per_case','case_tray_shrinkwrap_per_case',
--     'paktech_4pack_per_can','paktech_6pack_per_can',
--     'proper_pack_4pack_per_can','proper_pack_6pack_per_can','can_cost_per_unit');
--   -- (the two removed rows below would need re-inserting from history)

-- Remove the coarse rows the itemized catalog replaces.
delete from public.pricing_settings where key in ('case_tray_per_case','case_erector_per_case');

insert into public.pricing_settings (key, category, label, unit, value, sort_order) values
  ('case_tray_12_per_case',        'Packaging', '12-count Case Tray',              'per case',   0.50, 30),
  ('case_tray_24_per_case',        'Packaging', '24-count Case Tray',              'per case',   0.50, 31),
  ('case_tray_shrinkwrap_per_case','Packaging', 'Shrink-wrap a Case Tray',         'per case',   0.25, 32),
  ('paktech_4pack_per_can',        'Packaging', 'PakTech Handle — 4-pack',         'per can',    0.06, 33),
  ('paktech_6pack_per_can',        'Packaging', 'PakTech Handle — 6-pack',         'per can',    0.06, 34),
  ('proper_pack_4pack_per_can',    'Packaging', 'Proper Pack (eco carrier) — 4-pack','per can',   0.06, 35),
  ('proper_pack_6pack_per_can',    'Packaging', 'Proper Pack (eco carrier) — 6-pack','per can',   0.06, 36),
  ('can_cost_per_unit',            'Materials', 'Estimated Can Cost (pass-through)','per can',    0.32, 190)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
