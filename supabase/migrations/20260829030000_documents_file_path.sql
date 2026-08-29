-- Give public.documents somewhere to record where the file actually went.
--
-- ROLLBACK:
--   alter table public.documents drop column if exists file_path;
--
-- WHY
-- ---
-- 20260523_documents_inventory_clienttags.sql created public.documents with
-- metadata columns only -- no reference to the uploaded file:
--
--   id, client_id, client_name, name, doc_type, notes, uploaded_by, uploaded_at
--
-- saveDocument() in index.html has always inserted file_url and file_path
-- alongside those. Neither column exists, so PostgREST rejects the whole
-- insert with PGRST204 and the document is never saved. The Documents page
-- has therefore never worked: production holds 0 rows.
--
-- The upload runs BEFORE the insert, so each attempt also left the file in
-- the client-docs bucket with no row pointing at it. In practice nobody got
-- far enough to accumulate any -- every unreferenced object in that bucket
-- belongs to the artwork and portal-compliance features, which use their own
-- path prefixes and their own tables.
--
-- file_path, not file_url
-- -----------------------
-- client-docs is a PRIVATE bucket, so there is no durable URL to store. A
-- getPublicUrl() value returns HTTP 400, and a signed URL expires. The path is
-- the only stable reference; the client signs it at download time. This is the
-- same conclusion reached for compliance-photos in
-- 20260829020000_compliance_photos_bucket.sql.
--
-- No file_url column is added. Adding one would invite exactly the value that
-- cannot work.
--
-- The existing "client-docs customer read" storage policy matches on
-- name LIKE '<client_id>/%'. Documents saved without a client now go under a
-- 'general/' prefix rather than a bare leading slash, so they cannot collide
-- with that pattern.

alter table public.documents
  add column if not exists file_path text;

comment on column public.documents.file_path is
  'Object path in the private client-docs bucket. Not a URL: the bucket is '
  'private, so a public URL 400s and a signed URL expires. Sign at read time.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documents'
       and column_name = 'file_path'
  ) then
    raise exception 'documents.file_path was not created';
  end if;

  -- Guard against someone "fixing" the original error by adding file_url.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documents'
       and column_name = 'file_url'
  ) then
    raise exception
      'documents.file_url exists; client-docs is private, so a stored URL cannot work (see this migration header)';
  end if;
end $$;
