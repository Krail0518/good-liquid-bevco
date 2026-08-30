-- ============================================================
-- Enable Supabase Realtime on public.invoices
-- ============================================================
-- The CRM subscribes to invoices changes so a Stripe-webhook
-- mark-paid (or any other DB change) reflects in the UI without
-- a refresh. Supabase Realtime only emits Postgres CDC events
-- for tables in the `supabase_realtime` publication.
--
-- Adding a table that's already in the publication errors with
-- "relation is already member of publication", so guard with a
-- conditional check.
--
-- Idempotent. Safe to re-run.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'invoices'
  ) then
    execute 'alter publication supabase_realtime add table public.invoices';
  end if;
end $$;

-- Optional REPLICA IDENTITY FULL so the realtime payload includes the OLD
-- row on UPDATE/DELETE (needed for clients that diff old vs new — our
-- "row.status === 'paid' && oldRow.status !== 'paid'" notification logic
-- depends on this).
alter table public.invoices replica identity full;

notify pgrst, 'reload schema';
