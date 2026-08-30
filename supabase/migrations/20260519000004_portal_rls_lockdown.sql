-- ============================================================
-- Portal RLS lockdown + customer-self read policies
-- ============================================================
-- The existing broad "<table> authed for all to authenticated using (true)"
-- policies grant every authenticated Supabase user — including portal
-- customers signed in via ?portal=1 — full SELECT (and often write)
-- access to all rows. The dashboard's .eq('client_id', …) filter is
-- cosmetic; a customer poking at the JS console could read everything.
--
-- This migration:
-- 1. Adds an `is_staff_user()` helper — returns true when the auth user
--    has NO customer_users row (i.e. is staff, not a portal customer).
-- 2. Replaces the broad `using (true)` policies with `using (is_staff_user())`
--    so the wide-open staff access is gated on actually being staff.
-- 3. Adds per-table `customer self` SELECT policies for the new portal
--    sections (production_runs, sample_shipments, formulas) so a portal
--    customer can read THEIR rows only.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create or replace function public.is_staff_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not exists (
       select 1 from public.customer_users
       where auth_user_id = auth.uid() and active = true
     );
$$;
grant execute on function public.is_staff_user() to authenticated;

-- ── Helper: re-run a broad "<name> authed" policy gated on staff ──────────
do $$
declare
  v_policies text[][] := array[
    -- per-client confidential tables (must NOT leak to other clients' portals)
    array['production_runs authed', 'production_runs'],
    array['samples authed',         'sample_shipments'],
    array['formulas authed',        'formulas'],
    array['client_allergens authed','client_allergen_declarations'],
    array['defects authed',         'defects'],
    array['hold_tags authed',       'hold_tags'],
    array['yield_logs authed',      'yield_logs'],
    array['email_log authed',       'email_log'],
    array['email_schedule authed',  'email_schedule'],
    -- internal-ops tables (staff-only by intent)
    array['cip_logs authed',        'cip_logs'],
    array['cip_equipment authed',   'cip_equipment'],
    array['compliance_records authed','compliance_records'],
    array['compliance_tasks authed','compliance_tasks'],
    array['vendors authed',         'vendors'],
    array['case_studies authed full','case_studies'],
    array['resources authed full',  'resources'],
    array['content_calendar authed','content_calendar'],
    array['email_templates authed', 'email_templates'],
    array['inspector_tokens authed','inspector_tokens'],
    array['facilities authed',      'facilities'],
    array['audit_log authed select','audit_log'],
    array['audit_log read all authed','audit_log'],
    array['nps read authed',        'nps_responses']
  ];
  v_policy text;
  v_table  text;
  v_check_clause text;
begin
  for i in 1 .. array_length(v_policies, 1) loop
    v_policy := v_policies[i][1];
    v_table  := v_policies[i][2];
    execute format('drop policy if exists %I on public.%I', v_policy, v_table);
    -- Skip if table doesn't exist
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=v_table and c.relkind='r') then
      continue;
    end if;
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user())',
      v_policy || ' staff', v_table
    );
  end loop;
end $$;

-- invoices: the four split policies need separate handling because they
-- already coexist with the "invoices customer self" SELECT policy.
drop policy if exists "invoices select authed" on public.invoices;
drop policy if exists "invoices insert authed" on public.invoices;
drop policy if exists "invoices update authed" on public.invoices;
drop policy if exists "invoices delete authed" on public.invoices;
create policy "invoices staff select" on public.invoices
  for select to authenticated using (public.is_staff_user());
create policy "invoices staff insert" on public.invoices
  for insert to authenticated with check (public.is_staff_user());
create policy "invoices staff update" on public.invoices
  for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "invoices staff delete" on public.invoices
  for delete to authenticated using (public.is_staff_user());

-- clients: customer self already exists. Add staff broad access.
drop policy if exists "clients authed all" on public.clients;
create policy "clients staff all" on public.clients
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());

-- ── Customer self SELECT policies for new portal sections ────────────────
drop policy if exists "production_runs customer self" on public.production_runs;
create policy "production_runs customer self" on public.production_runs
  for select to authenticated
  using (client_id = public.current_customer_client_id());

drop policy if exists "sample_shipments customer self" on public.sample_shipments;
create policy "sample_shipments customer self" on public.sample_shipments
  for select to authenticated
  using (client_id = public.current_customer_client_id());

drop policy if exists "formulas customer self" on public.formulas;
create policy "formulas customer self" on public.formulas
  for select to authenticated
  using (client_id = public.current_customer_client_id());

notify pgrst, 'reload schema';
