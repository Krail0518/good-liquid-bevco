-- ============================================================
-- Security audit hardening (2026-07-25)
-- Closes customer-data-isolation holes found in the deep audit:
--   • an RPC that let any customer rebind to another client
--   • tables set to "any authenticated user" (i.e. also customers)
--   • world-readable inspector tokens and booking PII
--   • share-token policies that matched "token is not null" instead of
--     the actual token (anon could enumerate every shared invoice/decl)
-- is_staff_user() = authenticated AND not an active customer_users row.
-- ============================================================

-- ── 1. link_customer_user_by_email — STAFF ONLY ─────────────────────────
-- Was callable by any authenticated user (incl. a portal customer) to point
-- their own customer_users row at ANY client_id → full cross-customer takeover.
create or replace function public.link_customer_user_by_email(
  p_client_id uuid,
  p_email     text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email   text := lower(trim(p_email));
  v_user_id uuid;
  v_row_id  uuid;
begin
  -- Only staff (CRM users) may link a customer login to a client.
  if not public.is_staff_user() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_client_id');
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_auth_user', 'email', v_email);
  end if;

  select id into v_row_id from public.customer_users where auth_user_id = v_user_id limit 1;
  if v_row_id is not null then
    update public.customer_users
       set client_id    = p_client_id,
           email        = v_email,
           active       = true
     where id = v_row_id;
    return jsonb_build_object('ok', true, 'action', 'updated', 'auth_user_id', v_user_id);
  end if;

  insert into public.customer_users (auth_user_id, client_id, email, active)
  values (v_user_id, p_client_id, v_email, true);
  return jsonb_build_object('ok', true, 'action', 'created', 'auth_user_id', v_user_id);
end
$$;
grant execute on function public.link_customer_user_by_email(uuid, text) to authenticated;

-- ── 2. quotes — staff only (was auth.role()='authenticated') ────────────
drop policy if exists "quotes_admin_all" on public.quotes;
drop policy if exists "quotes staff all" on public.quotes;
create policy "quotes staff all" on public.quotes
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- ── 3. invoice_payments / recurring_invoices / expenses — staff only ────
-- (were auth.role()='authenticated' → any customer could read all financials
--  AND insert a payment row to fraudulently mark an invoice paid).
drop policy if exists "Staff read"   on public.invoice_payments;
drop policy if exists "Staff insert" on public.invoice_payments;
drop policy if exists "Staff update" on public.invoice_payments;
drop policy if exists "Staff delete" on public.invoice_payments;
drop policy if exists "invoice_payments staff read"   on public.invoice_payments;
drop policy if exists "invoice_payments staff insert" on public.invoice_payments;
drop policy if exists "invoice_payments staff update" on public.invoice_payments;
drop policy if exists "invoice_payments staff delete" on public.invoice_payments;
create policy "invoice_payments staff read"   on public.invoice_payments for select using (public.is_staff_user());
create policy "invoice_payments staff insert" on public.invoice_payments for insert with check (public.is_staff_user());
create policy "invoice_payments staff update" on public.invoice_payments for update using (public.is_staff_user()) with check (public.is_staff_user());
create policy "invoice_payments staff delete" on public.invoice_payments for delete using (public.is_super_user());

drop policy if exists "Staff all" on public.recurring_invoices;
drop policy if exists "recurring_invoices staff all" on public.recurring_invoices;
create policy "recurring_invoices staff all" on public.recurring_invoices
  for all using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "Staff all" on public.expenses;
drop policy if exists "expenses staff read"   on public.expenses;
drop policy if exists "expenses staff write"  on public.expenses;
drop policy if exists "expenses staff update" on public.expenses;
drop policy if exists "expenses staff delete" on public.expenses;
create policy "expenses staff read"   on public.expenses for select using (public.is_staff_user());
create policy "expenses staff write"  on public.expenses for insert with check (public.is_staff_user());
create policy "expenses staff update" on public.expenses for update using (public.is_staff_user()) with check (public.is_staff_user());
create policy "expenses staff delete" on public.expenses for delete using (public.is_super_user());

-- ── 4. company_docs — staff only (was using(true) read+write) ───────────
drop policy if exists "authed read"  on public.company_docs;
drop policy if exists "authed write" on public.company_docs;
drop policy if exists "company_docs staff read"  on public.company_docs;
drop policy if exists "company_docs staff write" on public.company_docs;
create policy "company_docs staff read"  on public.company_docs for select using (public.is_staff_user());
create policy "company_docs staff write" on public.company_docs for all using (public.is_staff_user()) with check (public.is_staff_user());

-- ── 5. production_lines — drop broad customer read ──────────────────────
drop policy if exists "production_lines customer read" on public.production_lines;

-- ── 6. inspector_tokens — remove anon read/update (world-readable tokens) ─
-- Validation is done server-side by is_valid_inspector_token(); anon never
-- needs to read or modify the token table.
drop policy if exists "inspector_tokens anon read"    on public.inspector_tokens;
drop policy if exists "inspector_tokens anon use bump" on public.inspector_tokens;

-- ── 7. bookings — drop anon read of confirmed bookings (PII) ────────────
-- Exposed booker_name/email/company/notes to anyone with the anon key.
-- Public availability is served server-side (booking-confirm edge function);
-- staff read via the authenticated "bookings owner all" policy.
drop policy if exists "bookings anon read confirmed" on public.bookings;

-- ── 8. Share-token views — exact-match RPCs instead of "token is not null" ─
-- The old anon policies (using share_token is not null) let anyone with the
-- public anon key enumerate EVERY shared invoice / allergen declaration.
-- Replace with SECURITY DEFINER functions that return only the row whose
-- token exactly matches, and drop the blanket anon SELECT policies.
create or replace function public.get_shared_invoice(p_token text)
returns setof public.invoices
language sql stable security definer set search_path = public as $$
  select * from public.invoices
  where share_token is not null and share_token = p_token
  limit 1;
$$;
grant execute on function public.get_shared_invoice(text) to anon, authenticated;

create or replace function public.get_shared_allergen_declaration(p_token text)
returns setof public.client_allergen_declarations
language sql stable security definer set search_path = public as $$
  select * from public.client_allergen_declarations
  where share_token is not null and share_token = p_token
  limit 1;
$$;
grant execute on function public.get_shared_allergen_declaration(text) to anon, authenticated;

drop policy if exists "invoices anon by token" on public.invoices;
drop policy if exists "client_allergens anon by token" on public.client_allergen_declarations;

notify pgrst, 'reload schema';
