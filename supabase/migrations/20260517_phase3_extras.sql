-- ============================================================
-- Phase 3 extras — vendor FSP-SC-001 fields + compliance-photos bucket
-- ============================================================
-- Optional. The Phase 3 features (#11 vendor FSP fields, #9 photo upload)
-- degrade gracefully if you skip this — they just won't persist that data.
-- Run when you're ready to use those features.
-- ============================================================

-- (11) Vendor FSP-SC-001 fields — Approved Supplier List columns
alter table public.vendors add column if not exists approval_date         date;
alter table public.vendors add column if not exists qualification_basis  text;
alter table public.vendors add column if not exists gfsi_cert_no         text;
alter table public.vendors add column if not exists cert_expires         date;
alter table public.vendors add column if not exists allergen_risk        text check (allergen_risk in (null, 'L','M','H'));
alter table public.vendors add column if not exists supplier_status      text default 'active' check (supplier_status in ('active','suspended','removed'));

-- (9) Compliance photo storage bucket
-- NOTE: bucket creation must be done in the Supabase Dashboard → Storage UI
-- OR via the Supabase CLI. SQL can't create buckets directly.
-- Steps in the dashboard:
--   1. Storage → New bucket → name: compliance-photos
--   2. Public access: ON (so the photo URLs work in PDF exports)
--   3. After creation, run the policy below in SQL Editor:

-- RLS policy on storage.objects so authenticated users can read/write only this bucket:
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='compliance-photos authed write') then
    create policy "compliance-photos authed write" on storage.objects
      for all to authenticated
      using  (bucket_id = 'compliance-photos')
      with check (bucket_id = 'compliance-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='compliance-photos public read') then
    create policy "compliance-photos public read" on storage.objects
      for select to anon
      using (bucket_id = 'compliance-photos');
  end if;
end $$;
