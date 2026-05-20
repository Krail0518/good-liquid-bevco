-- ============================================================
-- Lot-level documents (COAs, spec sheets, allergen statements)
-- ============================================================
-- Lets staff attach a PDF / image to a specific production run or
-- raw lot number, and lets the matching brand's portal customer
-- download it themselves — no more "can you email me the COA?"
-- back-and-forth.
--
-- Files live in the existing `client-docs` Supabase Storage bucket
-- under the path  client_id / lots / lot_number / <filename>.
-- This table just stores the metadata + storage path. The path is
-- never exposed directly; the portal hits sb.storage.createSignedUrl
-- to get a one-time download link, and RLS on this row gates whether
-- the customer was allowed to see it at all.
--
-- Doc types (kept loose so we can add more without a schema change):
--   coa, spec_sheet, allergen, kosher, organic, nutrition, other
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Production runs now carry their own lot number so the run modal
-- can default it into newly-attached documents.
alter table public.production_runs
  add column if not exists lot_number text;
create index if not exists idx_production_runs_lot on public.production_runs(lot_number);

create table if not exists public.lot_documents (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  production_run_id uuid references public.production_runs(id) on delete set null,
  lot_number        text,
  document_type     text not null default 'other'
                    check (document_type in ('coa','spec_sheet','allergen','kosher','organic','nutrition','other')),
  title             text not null,
  notes             text,
  file_path         text not null,  -- storage path inside the client-docs bucket
  file_name         text,           -- original filename, for the download attachment name
  file_size         bigint,
  mime_type         text,
  uploaded_by       uuid,
  uploaded_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_lot_documents_client on public.lot_documents(client_id, uploaded_at desc);
create index if not exists idx_lot_documents_run    on public.lot_documents(production_run_id);
create index if not exists idx_lot_documents_lot    on public.lot_documents(lot_number);
create index if not exists idx_lot_documents_type   on public.lot_documents(document_type);

drop trigger if exists trg_lot_documents_updated on public.lot_documents;
create trigger trg_lot_documents_updated before update on public.lot_documents
  for each row execute function public.set_updated_at();

alter table public.lot_documents enable row level security;

-- Staff can do anything.
drop policy if exists "lot_documents staff all" on public.lot_documents;
create policy "lot_documents staff all" on public.lot_documents
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- Portal customer can SELECT rows whose client_id matches the
-- client_id on their customer_users row. No insert/update/delete —
-- the customer reads + downloads only.
drop policy if exists "lot_documents customer self read" on public.lot_documents;
create policy "lot_documents customer self read" on public.lot_documents
  for select to authenticated
  using (client_id = public.current_customer_client_id());

notify pgrst, 'reload schema';
