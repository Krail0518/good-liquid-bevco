-- Flash pasteurization priced by can size; one changeover fee (Oct 24, 2026)
--
-- The Capabilities & Pricing 2026 deck lists flash pasteurization at 3 to 10
-- cents per can based on can volume. Mike set 12 oz at $0.03 and 16 oz at
-- $0.05. pasteurization_per_can stays the 12 oz rate so nothing that already
-- reads it changes meaning; the quote builder picks the 16 oz key when the
-- format is 16 oz.
--
-- Two changeover rows exist: change_over_fee ($100, read by the quote
-- builder) and changeover_fee ($125, read by nothing). Mike confirmed $125 is
-- correct, so the live key takes $125. Removing the unused changeover_fee row
-- needs owner confirmation and is left for a follow up.
--
-- ROLLBACK:
--   update public.pricing_settings set value = 0.05, label = 'Batch Flash Pasteurization' where key = 'pasteurization_per_can';
--   delete from public.pricing_settings where key = 'pasteurization_per_can_16';
--   update public.pricing_settings set value = 100 where key = 'change_over_fee';

update public.pricing_settings
   set value = 0.03, label = 'Batch Flash Pasteurization (12 oz)', updated_at = now()
 where key = 'pasteurization_per_can';

insert into public.pricing_settings (key, category, label, unit, value, sort_order)
values ('pasteurization_per_can_16', 'Canning add-ons', 'Batch Flash Pasteurization (16 oz)', 'per can', 0.05, 21)
on conflict (key) do update set value = excluded.value, label = excluded.label, updated_at = now();

update public.pricing_settings
   set value = 125, updated_at = now()
 where key = 'change_over_fee';
