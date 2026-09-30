-- ════════════════════════════════════════════════════════════════
-- Withdraw wh_client_names(): the warehouse-role change was cancelled
-- ════════════════════════════════════════════════════════════════
-- 20260930130000 added wh_client_names() so the warehouse role could see
-- client names in Warehouse Storage. The owner cancelled that change before
-- any page called it, so it is dropped again. Production returns to exactly
-- the authorization state in docs/database/authorization-baseline.txt, and
-- the warehouse role keeps no access to client names.
--
-- Both files stay in the history so the repository matches the migration
-- ledger, which records both.
--
-- ROLLBACK:
--   Re-apply 20260930130000_warehouse_client_names.sql.

drop function if exists public.wh_client_names();

notify pgrst, 'reload schema';
