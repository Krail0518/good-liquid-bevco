-- ════════════════════════════════════════════════════════════════
-- Warehouse role — DB-level guard (audit finding #8)
-- ════════════════════════════════════════════════════════════════
-- The 'warehouse' role is enforced only by hiding UI menu items. At the DB
-- level every staff table keys off is_gl_staff() ("an active profiles row"),
-- which is TRUE for warehouse too — so a warehouse user could read/write
-- clients, deals, invoices, quotes and the formula vault directly via the
-- REST API, exactly the "assumption expired when a new class of user shipped"
-- shape CLAUDE.md warns about.
--
-- Same technique as 20260807020000_tenant_isolation_guard.sql: don't rewrite
-- the ~80 permissive policies — add ONE RESTRICTIVE policy per sensitive table.
-- Restrictive policies are AND-ed with the permissive ones, so:
--   • admin / sales staff — unchanged (gl_is_warehouse() false → not false = pass)
--   • warehouse staff — blocked on the client/financial/IP tables below, but
--     KEEPS production, inventory, CIP, GMP docs, vendors and every other
--     operations table (none of those get this policy)
--   • portal customers — unaffected (they're not warehouse; their own tenant
--     guard still scopes them to their client_id)
--   • edge functions use service_role, which bypasses RLS entirely
--
-- Owner-confirmed split (2026-08-17): formulas = blocked from warehouse;
-- vendors/approved-supplier = warehouse keeps (GMP function).
--
-- ROLLBACK:
--   drop policy if exists "gl warehouse guard" on public.<each table below>;
--   drop function if exists public.gl_is_warehouse();

-- Warehouse identity: an active profiles row whose role is 'warehouse'.
create or replace function public.gl_is_warehouse()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.status, 'active') <> 'inactive'
      and p.role = 'warehouse'
  );
$$;
grant execute on function public.gl_is_warehouse() to authenticated;

do $$
declare
  t text;
  -- Client / financial / sales / IP tables warehouse must NOT touch.
  -- (Every name here is present in 20260807020000's guarded set.)
  warehouse_blocked text[] := array[
    'clients',
    'deals','deal_activity','deal_documents',
    'invoices','invoice_payments','recurring_invoices',
    'quotes',
    'referrals','referrers',
    'expenses','time_entries',
    'email_log','email_templates','email_schedule','followup_log',
    'customer_requests','customer_users',
    'client_notes','client_tags','client_rate_overrides',
    'client_allergen_declarations','client_artwork',
    'formulas',
    'qbo_tokens',
    'trade_shows','nps_responses','contact_submissions','onboarding',
    'content_calendar'
  ];
begin
  foreach t in array warehouse_blocked loop
    execute format('drop policy if exists "gl warehouse guard" on public.%I', t);
    -- using + with check so warehouse is denied reads AND writes.
    execute format(
      'create policy "gl warehouse guard" on public.%I as restrictive to authenticated '
      || 'using (not public.gl_is_warehouse()) with check (not public.gl_is_warehouse())', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
