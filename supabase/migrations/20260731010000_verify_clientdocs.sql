select
  (select count(*) from storage.buckets where id='client-docs') as bucket_exists,
  (select count(*) from storage.objects where bucket_id='client-docs') as object_count,
  (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname ilike '%client-docs%') as policies;
