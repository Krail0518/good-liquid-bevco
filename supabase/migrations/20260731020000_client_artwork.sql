-- ============================================================
-- client_artwork — per-client label artwork, one row per SKU
-- ============================================================
-- Customers run anywhere from a single can to 20+ SKUs, each with its own
-- label artwork. This table holds one row per SKU: a name, optional notes, an
-- approval status, and the uploaded artwork file (stored in the existing
-- client-docs Supabase Storage bucket, viewed via signed URLs).
--
-- Both staff (in the client card) and the customer (in their portal) can add
-- SKUs and upload artwork. RLS mirrors lot_documents: staff full access;
-- portal customers see and manage only their own client's rows via
-- current_customer_client_id().
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.client_artwork (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete cascade,
  sku_name     text not null,
  description  text,
  file_path    text,
  file_type    text,
  status       text not null default 'submitted'
               check (status in ('submitted','in_review','approved','rejected')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_client_artwork_client on public.client_artwork(client_id, created_at desc);

alter table public.client_artwork enable row level security;

-- Staff: full access.
drop policy if exists "client_artwork staff all" on public.client_artwork;
create policy "client_artwork staff all" on public.client_artwork
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- Portal customer: see / add / edit / remove only their own client's SKUs.
drop policy if exists "client_artwork customer read" on public.client_artwork;
create policy "client_artwork customer read" on public.client_artwork
  for select to authenticated
  using (client_id = public.current_customer_client_id());

drop policy if exists "client_artwork customer insert" on public.client_artwork;
create policy "client_artwork customer insert" on public.client_artwork
  for insert to authenticated
  with check (client_id = public.current_customer_client_id());

drop policy if exists "client_artwork customer update" on public.client_artwork;
create policy "client_artwork customer update" on public.client_artwork
  for update to authenticated
  using (client_id = public.current_customer_client_id())
  with check (client_id = public.current_customer_client_id());

drop policy if exists "client_artwork customer delete" on public.client_artwork;
create policy "client_artwork customer delete" on public.client_artwork
  for delete to authenticated
  using (client_id = public.current_customer_client_id());

notify pgrst, 'reload schema';
