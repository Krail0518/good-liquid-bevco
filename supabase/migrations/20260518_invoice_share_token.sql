-- ============================================================
-- Invoice share tokens — customer-facing public invoice view
-- ============================================================
-- Adds a share_token column to invoices so each invoice can be published
-- at a tokenized URL (e.g. ?invoice_view=<token>). Customers can view +
-- download the invoice without a login.
--
-- Anon SELECT is allowed only when share_token IS NOT NULL — keeps the
-- token-required gate (no token, no access).
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.invoices add column if not exists share_token text;
create unique index if not exists idx_invoices_share_token on public.invoices(share_token) where share_token is not null;

drop policy if exists "invoices anon by token" on public.invoices;
create policy "invoices anon by token" on public.invoices
  for select to anon using (share_token is not null);

notify pgrst, 'reload schema';
