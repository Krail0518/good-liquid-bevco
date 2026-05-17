-- ============================================================
-- Invoices table — add missing DELETE policy (and broaden write policies)
-- ============================================================
-- Symptom: clicking the trash icon on an invoice ran the JS path, the
-- row vanished from the UI, but refreshing the page brought it back.
--
-- Cause: RLS is enabled on public.invoices but no DELETE policy exists
-- for authenticated users. With RLS on, a missing DELETE policy means
-- the operation is silently denied — 0 rows affected, no error
-- returned. The Supabase JS client reported success; the row stayed.
--
-- This adds permissive policies for authenticated users on all four
-- operations so the CRM admin can manage invoices freely. The CRM is
-- single-tenant (one company, Good-Liquid staff only); fine-grained
-- per-user ownership is not the threat model here.
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.invoices enable row level security;

drop policy if exists "invoices select authed" on public.invoices;
create policy "invoices select authed" on public.invoices
  for select to authenticated using (true);

drop policy if exists "invoices insert authed" on public.invoices;
create policy "invoices insert authed" on public.invoices
  for insert to authenticated with check (true);

drop policy if exists "invoices update authed" on public.invoices;
create policy "invoices update authed" on public.invoices
  for update to authenticated using (true) with check (true);

drop policy if exists "invoices delete authed" on public.invoices;
create policy "invoices delete authed" on public.invoices
  for delete to authenticated using (true);

notify pgrst, 'reload schema';
