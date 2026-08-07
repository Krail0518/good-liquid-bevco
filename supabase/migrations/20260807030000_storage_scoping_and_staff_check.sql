-- ════════════════════════════════════════════════════════════════
-- client-docs bucket scoping + remove the is_staff_user() fallback
-- ════════════════════════════════════════════════════════════════
-- Audit findings (2026-08-06), both critical:
--
-- 1. The client-docs bucket policies were `TO authenticated USING
--    (bucket_id = 'client-docs')` for SELECT/INSERT/UPDATE/DELETE — i.e.
--    ANY logged-in user (including every portal customer and, since
--    signup is open, any stranger) could list, download, overwrite and
--    delete EVERY client's NDAs, W-9s, Process Authority letters and
--    label artwork. Now: staff full access; a portal customer may read
--    only files under their own client's prefix or referenced by their
--    own deal_documents / lot_documents rows, and may upload only under
--    their own prefix. No customer update/delete.
--
--    Upload path conventions this preserves:
--      <clientId>/docs/…     staff client documents
--      <clientId>/artwork/…  label artwork (portal + staff)
--      <clientId>/portal/…   customer agreement/NDA uploads
--      deal/<dealId>/…       pipeline deal documents (staff), readable by
--                            the customer once carried over to their client
--
-- 2. is_staff_user() returned TRUE for any authenticated user with no
--    customer_users row. With open signup that meant anyone who
--    registered was "staff" to every SECURITY DEFINER RPC that gates on
--    it (gl_onboarding_create, link_customer_user_by_email, …) — those
--    bypass RLS, so the tenant guard in 20260807020000 does not cover
--    them. Membership now requires an active public.profiles row, which
--    is what the CRM already treats as the staff roster.
--
-- ROLLBACK: see git history for the previous definitions.

-- ── 1. Storage ────────────────────────────────────────────────────
drop policy if exists "Authenticated read client-docs"   on storage.objects;
drop policy if exists "Authenticated write client-docs"  on storage.objects;
drop policy if exists "Authenticated update client-docs" on storage.objects;
drop policy if exists "Authenticated delete client-docs" on storage.objects;

drop policy if exists "client-docs staff all" on storage.objects;
create policy "client-docs staff all" on storage.objects
  for all to authenticated
  using      (bucket_id = 'client-docs' and public.is_gl_staff())
  with check (bucket_id = 'client-docs' and public.is_gl_staff());

drop policy if exists "client-docs customer read" on storage.objects;
create policy "client-docs customer read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-docs'
    and public.current_customer_client_id() is not null
    and (
      name like public.current_customer_client_id()::text || '/%'
      or exists (select 1 from public.deal_documents d
                  where d.file_path = storage.objects.name
                    and d.client_id = public.current_customer_client_id())
      or exists (select 1 from public.lot_documents l
                  where l.file_path = storage.objects.name
                    and l.client_id = public.current_customer_client_id())
    )
  );

drop policy if exists "client-docs customer upload" on storage.objects;
create policy "client-docs customer upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-docs'
    and public.current_customer_client_id() is not null
    and name like public.current_customer_client_id()::text || '/%'
  );

-- ── 2. Staff identity ─────────────────────────────────────────────
create or replace function public.is_staff_user()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and coalesce(p.status, 'active') <> 'inactive'
  );
$$;

notify pgrst, 'reload schema';
