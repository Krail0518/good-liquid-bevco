-- ════════════════════════════════════════════════════════════════
-- Portal customers may upload agreements onto their own account
-- ════════════════════════════════════════════════════════════════
-- The portal's new AGREEMENTS & CONTRACTS section lets a signed-in
-- customer upload their signed NDA (or another document). The file goes
-- to the client-docs bucket (already writable by any authenticated
-- user) and is indexed by a deal_documents row. Customers could already
-- SELECT their client's rows ("deal_documents customer read"); this adds
-- the matching INSERT policy, scoped hard to their own client and never
-- to a pipeline deal.

drop policy if exists "deal_documents customer upload" on public.deal_documents;
create policy "deal_documents customer upload" on public.deal_documents
  for insert to authenticated
  with check (
    deal_id is null
    and client_id is not null
    and client_id = public.current_customer_client_id()
  );

notify pgrst, 'reload schema';
