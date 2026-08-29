-- Create the compliance-photos bucket, private.
--
-- ROLLBACK:
--   delete from storage.objects where bucket_id = 'compliance-photos';
--   delete from storage.buckets where id = 'compliance-photos';
--   -- (destroys the evidence files; export them first if any exist)
--
-- WHY
-- ---
-- crm-compliance.js has uploaded to a "compliance-photos" bucket since
-- 20260517_phase3_extras.sql shipped its RLS policies. The bucket itself was
-- never created. Three features have therefore never worked:
--
--   * hold-tag evidence photos      (crm-compliance.js uploadPhoto)
--   * defect / NCR photos           (crm-compliance.js uploadCompliancePhoto)
--   * PCQI-signed controlled docs   (DOC-CTRL-001 records)
--
-- Each fails with a message telling staff to "Create the compliance-photos
-- Storage bucket in Supabase" -- i.e. the product asked for the exact
-- dashboard change CLAUDE.md rule 2 forbids. This migration is that change,
-- made reviewable.
--
-- PRIVATE, not public
-- -------------------
-- The obvious reading of the client code is that the bucket was meant to be
-- public: it calls getPublicUrl(). That is the wrong default here.
--
-- Portal customers are competing beverage brands, and a public bucket serves
-- any object to anyone holding the URL, with no auth and no RLS -- object
-- paths are guessable ('hold/<epoch-ms>-<6 chars>.jpg') and URLs leak through
-- history, referrers and screenshots. The contents are FDA-defensible
-- evidence: quarantine photos, defect images, signed food-safety plans. One
-- brand reading another's hold tags is the outcome CLAUDE.md names as the
-- worst this system can produce.
--
-- Both existing buckets (client-docs, sales-decks) are private. This one
-- matches them. 20260828180304_compliance_photos_staff_only.sql already
-- scoped the policies to public.is_gl_staff() and anticipated this:
--
--   "If the bucket is instead created PRIVATE, getPublicUrl() will not work
--    and the app should move to createSignedUrl()."
--
-- The client change lands with this migration.
--
-- No anon policy exists for this bucket, so the inspector-token flow in
-- auditor.html cannot read it. That is intended: the token grants SELECT on
-- specific compliance TABLES, not on evidence files. Widening it is a
-- separate decision with its own review.
--
-- Limits: 25 MB matches the largest expected item (a scanned, signed plan).
-- The MIME allowlist keeps the bucket to images and PDFs, so an upload field
-- reachable by staff cannot become a general file drop.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-photos',
  'compliance-photos',
  false,
  26214400,  -- 25 MiB
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Guard: if this bucket is ever flipped public by hand in the dashboard, the
-- drift check fails on the next run. The policies below are asserted here too
-- so this migration is self-contained evidence of the intended end state.
do $$
declare
  v_public boolean;
  v_policies int;
begin
  select public into v_public from storage.buckets where id = 'compliance-photos';
  if v_public is distinct from false then
    raise exception 'compliance-photos must be private, got public=%', v_public;
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and qual like '%compliance-photos%';
  if v_policies = 0 then
    raise exception 'compliance-photos has no storage policy; refusing to create an unreachable bucket';
  end if;

  -- Anything granting anon access to this bucket would defeat the point.
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles::text like '%anon%'
      and (coalesce(qual,'') || coalesce(with_check,'')) like '%compliance-photos%'
  ) then
    raise exception 'an anon policy references compliance-photos; refusing to create a private bucket that is publicly readable';
  end if;
end $$;
