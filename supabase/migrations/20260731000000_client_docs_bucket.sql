-- ============================================================
-- client-docs storage bucket + RLS
-- ============================================================
-- Client compliance uploads (W-9, sales-tax exemption certificate,
-- Process Authority letter) are stored in the private `client-docs`
-- Supabase Storage bucket and read back via short-lived signed URLs.
--
-- The bucket-creation SQL previously lived only in an in-app "run this
-- yourself" modal, so on any project where an admin never ran it every
-- compliance-doc upload failed silently: uploadComplianceDoc() returned
-- '' on the storage error, the record was still marked "on file", and
-- there was no stored file to view. This migration commits that setup as
-- a real, applied migration so the bucket + policies always exist.
--
-- Idempotent. Safe to re-run.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;

-- Authenticated staff can read / write / update / delete objects in this
-- bucket. Reads are surfaced to the app only via signed URLs.
drop policy if exists "Authenticated read client-docs"   on storage.objects;
create policy "Authenticated read client-docs"   on storage.objects
  for select to authenticated using (bucket_id = 'client-docs');

drop policy if exists "Authenticated write client-docs"  on storage.objects;
create policy "Authenticated write client-docs"  on storage.objects
  for insert to authenticated with check (bucket_id = 'client-docs');

drop policy if exists "Authenticated update client-docs" on storage.objects;
create policy "Authenticated update client-docs" on storage.objects
  for update to authenticated using (bucket_id = 'client-docs');

drop policy if exists "Authenticated delete client-docs" on storage.objects;
create policy "Authenticated delete client-docs" on storage.objects
  for delete to authenticated using (bucket_id = 'client-docs');
