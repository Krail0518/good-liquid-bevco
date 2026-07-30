-- Documents library: a DB-listed catalog of food-safety documents.
--
-- DESIGN
--   The company's written food-safety program (SOP supplements, blank register
--   templates, regulatory guides) lives as files served from /docs. Rather than
--   hardcode that list in the app, each document is registered here as a row —
--   code, title, category, description, file_url and revision — so the library
--   is data, not markup.
--
--   The CRM Daily GMP page reads this table to render the "Documents" library,
--   and the read-only auditor (inspector token) portal reads it too so an
--   inspector can pull the same reference documents during a review. Files
--   themselves are hosted under /docs; this table only points at them.
--
--   Nothing here is app-specific SQL beyond the standard patterns; the document
--   registry lives in Postgres and mirrors the RLS used by gmp_templates.

-- 1) Document registry.
create table if not exists public.gmp_documents (
  id             uuid primary key default gen_random_uuid(),
  doc_code       text unique not null,       -- e.g. DOC-SOP-SUPP
  title          text not null,              -- "GMP SOP Supplement"
  category       text,                       -- SOP|Registers|Regulatory|...
  description    text,
  file_url       text not null,              -- served from /docs
  file_type      text,                       -- docx|xlsx|pdf|...
  rev            text default '1.0',
  effective_date date,
  sort_order     integer default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_gmp_documents_active_sort on public.gmp_documents(active, sort_order);

alter table public.gmp_documents enable row level security;

drop policy if exists "gmp_documents staff all" on public.gmp_documents;
create policy "gmp_documents staff all" on public.gmp_documents
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- Auditor (inspector token) read access to the library, matching the existing
-- inspector read policies on gmp_templates/compliance_records/etc.
drop policy if exists "gmp_documents inspector read" on public.gmp_documents;
create policy "gmp_documents inspector read" on public.gmp_documents
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- 2) Seed the core library documents (idempotent).
insert into public.gmp_documents (doc_code, title, category, description, file_url, file_type, rev, effective_date, sort_order) values
('DOC-SOP-SUPP','GMP SOP Supplement','SOP','Double-Seam Integrity, Label Control & Reconciliation, and Master Sanitation Schedule SOPs.','/docs/GMP-SOP-Supplement.docx','docx','1.0','2026-07-30',10),
('DOC-REGISTERS','GMP Registers (blank templates)','Registers','Print-ready register sheets whose columns match the digital Daily GMP forms.','/docs/GMP-Registers.xlsx','xlsx','1.0','2026-07-30',20),
('DOC-LACF','LACF / Acidified Foods Regulatory Guide','Regulatory','FDA 21 CFR 108/113/114 roadmap — process authority, FCE/SID filings, Better Process Control School, records.','/docs/LACF-Acidified-Regulatory-Guide.docx','docx','1.0','2026-07-30',30)
on conflict (doc_code) do nothing;

notify pgrst, 'reload schema';
