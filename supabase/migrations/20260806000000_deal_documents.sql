-- ============================================================
-- deal_documents — documents captured against a pipeline deal
-- ============================================================
-- Customers routinely send an NDA, a Process Authority letter, formulas and
-- label artwork while a deal is still in the pipeline — before there is a
-- client record to hang them on. This table indexes those files (which live in
-- the existing client-docs Storage bucket, viewed via signed URLs).
--
-- On convert-to-client the rows are stamped with client_id (and the PA letter /
-- labels are ALSO filed into the client's dedicated homes: the PA-letter
-- compliance slot on clients, and client_artwork SKUs). That hand-off lives in
-- crm-onboarding.js; this table just needs a deal_id, a nullable client_id, and
-- a doc_type so both sides can filter.
--
-- RLS mirrors client_artwork: staff full access; a converted portal customer
-- may read their own carried-over docs via current_customer_client_id().
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.deal_documents (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references public.deals(id)   on delete cascade,
  client_id   uuid references public.clients(id) on delete set null,
  doc_type    text not null default 'Other',
  name        text,
  notes       text,
  file_path   text,
  file_type   text,
  uploaded_by text,
  created_at  timestamptz not null default now()
);

create index if not exists deal_documents_deal_idx   on public.deal_documents(deal_id);
create index if not exists deal_documents_client_idx on public.deal_documents(client_id);

alter table public.deal_documents enable row level security;

-- Staff: full access.
drop policy if exists "deal_documents staff all" on public.deal_documents;
create policy "deal_documents staff all" on public.deal_documents
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- Portal customer: read only their own client's carried-over documents.
drop policy if exists "deal_documents customer read" on public.deal_documents;
create policy "deal_documents customer read" on public.deal_documents
  for select to authenticated
  using (client_id = public.current_customer_client_id());

notify pgrst, 'reload schema';
