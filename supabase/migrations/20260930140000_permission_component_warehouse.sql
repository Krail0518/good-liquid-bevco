-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage on the Users & Permissions page
-- ════════════════════════════════════════════════════════════════
-- Every CRM page is a row in permission_components, and the Users &
-- Permissions page draws one checkbox per row. Warehouse Storage shipped
-- without one, so it could not be turned off per user.
--
-- default_on = true keeps today's behaviour: every admin and sales user who
-- can open the page now still can, until someone unticks it for them.
-- Admins bypass component checks entirely (glCan), as for every other page.
-- sort_order 72 places it after Sample Shipments (71), its sidebar neighbour.
--
-- This is a permission CATALOGUE row, not a grant: it changes no RLS, no
-- table grant and no function ACL. Role limits still apply on top of it --
-- the warehouse and viewer roles cannot open this page whatever the box says.
--
-- ROLLBACK:
--   delete from public.user_permissions where component_id = 'page.warehouse';
--   delete from public.permission_components where id = 'page.warehouse';
--   Per-user overrides for the page are lost; everyone returns to the role
--   default (admin and sales can open it).

insert into public.permission_components (id, label, category, description, default_on, sort_order)
values ('page.warehouse', 'Warehouse Storage', 'page', 'Pallets at CONRI, transfers, paperwork', true, 72)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
