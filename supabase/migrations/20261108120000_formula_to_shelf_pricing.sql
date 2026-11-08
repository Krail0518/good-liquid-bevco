-- ════════════════════════════════════════════════════════════════
-- Formula to Shelf: package prices in pricing_settings
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   delete from public.pricing_settings where key in (
--     'launch_toolkit','launch_core_per_sku','launch_full_per_sku',
--     'launch_membership_per_month','launch_extra_sample_round');
--
-- The founder launch program (goodliquidbevco.com/launch) is now sold from the
-- quote builder and the invoice builder as checkboxes. Its prices live here,
-- beside every other flat price, so they are edited on the "Prices" screen
-- and the page, the quote and the invoice cannot drift apart in code.
--
-- Values match the published launch page as of 2026-11-08.
--
-- Data only. No table, policy, grant or function changes: pricing_settings
-- keeps its existing RLS (staff read, admin write). ON CONFLICT DO NOTHING, so
-- re-running never overwrites a price someone has since edited.

insert into public.pricing_settings (key, category, label, unit, value, sort_order) values
  ('launch_toolkit',              'Formula to Shelf', 'Formula to Shelf: Launch Toolkit',           'one time',  147,  300),
  ('launch_core_per_sku',         'Formula to Shelf', 'Formula to Shelf: Core Launch',              'per SKU',   4250, 301),
  ('launch_full_per_sku',         'Formula to Shelf', 'Formula to Shelf: Full Launch',              'per SKU',   7500, 302),
  ('launch_membership_per_month', 'Formula to Shelf', 'Formula to Shelf: Founder Membership',       'per month', 199,  303),
  ('launch_extra_sample_round',   'Formula to Shelf', 'Formula to Shelf: Additional Sample Round',  'per round', 475,  304)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
