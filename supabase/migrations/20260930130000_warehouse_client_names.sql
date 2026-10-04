-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage for the warehouse role: client NAMES only
-- ════════════════════════════════════════════════════════════════
-- The owner asked for the warehouse role (floor / QA staff) to use Warehouse
-- Storage. That role is deliberately blocked from `clients` by the restrictive
-- "gl warehouse guard" (20260817000000_warehouse_rls_guard.sql, owner-confirmed
-- 2026-08-17), because the table also holds contacts, billing addresses, EIN,
-- payment terms, credit limits and Stripe/QuickBooks ids. Probed as the real
-- warehouse account before this change: 7 pallets and 1 transfer visible,
-- 0 clients. The page opened with every client name blank and no client to
-- pick when starting a transfer or a SKU.
--
-- The fix is NOT to lift that guard. It is this function, which returns two
-- columns, id and name, to staff and to nobody else. Client names are already
-- printed on every pallet label and packing list the warehouse handles, so
-- this discloses nothing the floor does not already carry in its hands.
--
-- RLS is row-level, so a view over `clients` cannot narrow columns (see
-- 20260914090200_internal_notes.sql). A SECURITY DEFINER function with a fixed
-- column list is the only way to give out a column without giving out the row.
--
-- Who gets rows:
--   admin, sales, warehouse, viewer staff -> is_gl_staff() true  -> id, name
--   portal customer (no profiles row)     -> is_gl_staff() false -> nothing
--   self-registered stranger              -> false               -> nothing
--   anon                                  -> no EXECUTE
--
-- ROLLBACK:
--   drop function if exists public.wh_client_names();
--   The warehouse role then sees blank client names on the page again; nothing
--   else calls it.

set search_path = public, extensions;

create or replace function public.wh_client_names()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select c.id, c.name
    from public.clients c
   where public.is_gl_staff()
   order by c.name;
$fn$;

revoke all on function public.wh_client_names() from public, anon;
grant execute on function public.wh_client_names() to authenticated;

notify pgrst, 'reload schema';
