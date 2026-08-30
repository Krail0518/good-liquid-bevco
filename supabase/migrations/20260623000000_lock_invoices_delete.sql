-- ============================================================
-- Lock invoice DELETE to super-users only
-- ============================================================
-- Invoices are financial records. A staff member accidentally
-- clicking the trash icon on an invoice row permanently removes
-- the row from Supabase — there is no soft-delete or undo.
--
-- This migration replaces the permissive "delete to authenticated"
-- policy (which let any logged-in staff member delete any invoice)
-- with a super-user-only gate, matching the pattern already used
-- for compliance_records, formulas, defects, etc.
--
-- Mike's account (mike@goodliquid.com) has is_super_user = true
-- (set in 20260523_super_user_rls_enforcement.sql), so he can
-- still delete invoices normally. Regular staff cannot.
--
-- The UI 🗑 button and deleteInvoice() remain in place; the call
-- will return 0 rows affected (and the JS already surfaces an
-- alert when that happens).
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.invoices enable row level security;

drop policy if exists "invoices delete authed"   on public.invoices;
drop policy if exists "invoices super delete"    on public.invoices;

create policy "invoices super delete" on public.invoices
  for delete to authenticated
  using (public.is_super_user());

notify pgrst, 'reload schema';
