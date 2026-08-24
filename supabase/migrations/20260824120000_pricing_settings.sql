-- ════════════════════════════════════════════════════════════════
-- pricing_settings — one editable home for every flat / add-on price
-- ════════════════════════════════════════════════════════════════
-- The volume tier ladders already live in canning_rates / bottling_rates and
-- are editable from the "$ Pricing" screen. Everything else the quote builder
-- charges — nitrogen, pasteurization, case trays, the case erector, pallets and
-- pallet wrap, keg fill, the empty keg, R&D / IP / benchtop fees, bottling
-- add-ons — was hard-coded in crm-quote-builder.js, so Mike had to go through
-- the assistant for every change. This table makes those staff-editable in the
-- CRM, and the quote builder reads them at open time (falling back to the same
-- defaults if the table is unreachable).
--
-- Values seeded from the Aug 2026 capabilities deck and Mike's stated numbers.
--
-- ROLLBACK: drop table public.pricing_settings;

create table if not exists public.pricing_settings (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- stable machine key the code reads
  category    text not null,                 -- grouping for the editor UI
  label       text not null,                 -- human label shown in the editor
  unit        text,                          -- 'per can', 'per case', 'per pallet', …
  value       numeric not null default 0,    -- the price / number
  sort_order  int  not null default 0,
  updated_at  timestamptz not null default now()
);

-- Prices are staff-only business config: no anon, no portal customer. Read and
-- write both scoped to public.is_gl_staff() (an active profiles row). The public
-- marketing site keeps its own copy; only the internal quote builder reads this.
alter table public.pricing_settings enable row level security;

drop policy if exists "pricing_settings staff read"  on public.pricing_settings;
drop policy if exists "pricing_settings staff write" on public.pricing_settings;
create policy "pricing_settings staff read"  on public.pricing_settings
  for select to authenticated using (public.is_gl_staff());
create policy "pricing_settings staff write" on public.pricing_settings
  for update to authenticated using (public.is_gl_staff()) with check (public.is_gl_staff());

grant select, update on public.pricing_settings to authenticated;

-- ── Seed (idempotent on key) ────────────────────────────────────────────────
insert into public.pricing_settings (key, category, label, unit, value, sort_order) values
  -- Canning add-ons
  ('nitrogen_per_can',            'Canning add-ons', 'Nitrogen Dosing',              'per can',    0.03,  10),
  ('pasteurization_per_can',      'Canning add-ons', 'Batch Flash Pasteurization',   'per can',    0.05,  20),
  -- Packaging (per case)
  ('case_tray_per_case',          'Packaging',       'Case Tray (12 or 24-count)',   'per case',   0.50,  30),
  ('case_erector_per_case',       'Packaging',       'Case Erector + Shrink Wrap',   'per case',   1.25,  40),
  -- Pallet
  ('pallet_each',                 'Pallet',          'Pallet',                       'per pallet', 12.00, 50),
  ('pallet_wrap_each',            'Pallet',          'Pallet Shrink Wrap',           'per pallet',  8.00, 60),
  ('cases_per_pallet',            'Pallet',          'Cases per Pallet',             'cases',      80,    70),
  -- Keg
  ('keg_fill_per_keg',            'Keg',             'Keg Filling (labor)',          'per keg',    12.00, 80),
  ('empty_keg_per_keg',           'Keg',             'Empty One-Way Keg',            'per keg',    17.50, 90),
  -- Formulation / IP
  ('rd_starting_fee',             'Formulation & IP','R&D Starting Fee',             'per SKU',    2500,  100),
  ('ip_license_year',             'Formulation & IP','IP License',                   'per year',   6000,  110),
  ('ip_buyout',                   'Formulation & IP','IP Buyout',                    'one-time',   15000, 120),
  ('benchtop_per_sku',            'Formulation & IP','Benchtop Verification',        'per SKU',    500,   130),
  -- Bottling add-ons
  ('bottling_pasteurization_per_btl','Bottling add-ons','Batch Flash Pasteurization','per bottle', 0.20,  140),
  ('bottling_otl_per_btl',        'Bottling add-ons','Over-the-Top Labels',          'per bottle', 0.20,  150),
  ('bottling_labels_per_btl',     'Bottling add-ons','Labels Front & Back',          'per bottle', 0.06,  160),
  -- Fees & sourcing
  ('changeover_fee',              'Fees',            'Changeover Fee',               'per changeover', 125, 170),
  ('procurement_fee_pct',         'Fees',            'Materials Procurement Fee',    'percent',    10,    180)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
