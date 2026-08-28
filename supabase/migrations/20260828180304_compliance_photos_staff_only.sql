-- Scope the compliance-photos storage policies to staff.
--
-- ROLLBACK:
--   drop policy if exists "compliance-photos staff all" on storage.objects;
--   create policy "compliance-photos authed write" on storage.objects
--     for all to authenticated
--     using (bucket_id = 'compliance-photos') with check (bucket_id = 'compliance-photos');
--   create policy "compliance-photos public read" on storage.objects
--     for select to anon using (bucket_id = 'compliance-photos');
--
-- WHY
-- ---
-- 20260517_phase3_extras.sql created two policies for this bucket:
--
--   create policy "compliance-photos authed write" on storage.objects
--     for all to authenticated
--     using  (bucket_id = 'compliance-photos')
--     with check (bucket_id = 'compliance-photos');
--
--   create policy "compliance-photos public read" on storage.objects
--     for select to anon using (bucket_id = 'compliance-photos');
--
-- `FOR ALL` with only a bucket_id test means SELECT/INSERT/UPDATE/DELETE for
-- ANY authenticated user — every portal customer, and (before
-- 20260828175051_staff_profile_requires_invite.sql) any self-registered
-- stranger. Portal customers are competing beverage brands.
--
-- 20260807030000_storage_scoping_and_staff_check.sql identified exactly this
-- shape as critical and fixed it for client-docs. It never came back for
-- compliance-photos. This migration closes that gap.
--
-- The bucket holds FDA-defensible evidence: hold-tag photos
-- (crm-compliance.js:2771), defect/NCR photos (:3382), and PCQI-signed
-- controlled documents (:3815, written to compliance_records as
-- form_code='DOC-CTRL-001').
--
-- CURRENT EXPOSURE: none. Verified 2026-08-28 — the compliance-photos bucket
-- does not exist yet (storage.buckets holds only client-docs), so the two
-- policies are dangling and there are 0 objects to reach. This is a LATENT
-- hole: crm-compliance.js prompts staff to "Create the compliance-photos
-- Storage bucket in Supabase", and the moment anyone does, the permissive
-- policies above activate. Hardening before the bucket exists means it is
-- safe by default rather than briefly wide open.
--
-- ON THE anon SELECT
-- ------------------
-- Dropped deliberately. The app reads these via getPublicUrl(), and for a
-- PUBLIC bucket Storage serves object bytes without consulting RLS — so image
-- display and PDF export keep working without it. What the policy additionally
-- allowed was listing storage.objects rows as anon, i.e. enumerating the whole
-- bucket. That is not needed and is not wanted.
--
-- If the bucket is instead created PRIVATE, getPublicUrl() will not work and
-- the app should move to createSignedUrl(); re-adding an anon policy would not
-- fix that case either.
--
-- NOT ADDRESSED HERE: the bucket's absence also means compliance photo upload
-- is currently broken in the product (hold tags, defect photos, PCQI signing
-- all fail). Creating it is a product decision — public vs private changes
-- which URL API the client must use — so it is deliberately left out of a
-- security migration.

drop policy if exists "compliance-photos authed write" on storage.objects;
drop policy if exists "compliance-photos public read"  on storage.objects;

-- Mirrors "client-docs staff all" from 20260807030000.
create policy "compliance-photos staff all" on storage.objects
  for all to authenticated
  using      (bucket_id = 'compliance-photos' and public.is_gl_staff())
  with check (bucket_id = 'compliance-photos' and public.is_gl_staff());
