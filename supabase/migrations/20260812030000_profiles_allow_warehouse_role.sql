-- Allow the 'warehouse' role on staff profiles.
-- 2026-08-12
--
-- The frontend has long defined a 'warehouse' role (PERMISSIONS.warehouse:
-- dashboard, production runs/calendar, inventory, CIP, defects, yield, samples,
-- tasks, announcements) for floor/QA staff who log CIP and production but must
-- NOT see clients, pipeline, invoices, or referrals. But profiles.role only
-- permitted admin/sales/viewer, so nobody could actually be assigned to it —
-- warehouse staff were being put on the over-privileged 'sales' role instead.
-- Widen the CHECK constraint to include 'warehouse'. Additive and safe: no
-- existing value is removed, and is_gl_staff()/is_staff_user() key off an active
-- profiles row (not the role value), so CIP/GMP writes keep working.
--
-- ROLLBACK:
--   alter table public.profiles drop constraint profiles_role_check;
--   alter table public.profiles add constraint profiles_role_check
--     check (role = any (array['admin','sales','viewer']));

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin','sales','viewer','warehouse']));
