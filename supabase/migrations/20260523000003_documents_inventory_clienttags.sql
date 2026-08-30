-- ============================================================
-- documents + inventory + client_tags (off localStorage)
-- ============================================================
-- 6th, 7th, 8th of 15. All three are per-client / per-team data
-- that lost cross-device sync to localStorage.
-- ============================================================

-- ── DOCUMENTS — metadata only (not file contents) ────────────
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.clients(id) on delete set null,
  client_name   text,
  name          text not null,
  doc_type      text,            -- NDA / Formula / Label Artwork / COA / Contract / Invoice / Other
  notes         text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_documents_client on public.documents(client_id, uploaded_at desc);
create index if not exists idx_documents_uploaded on public.documents(uploaded_at desc);

alter table public.documents enable row level security;
drop policy if exists "documents staff all" on public.documents;
create policy "documents staff all" on public.documents
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── INVENTORY — supply items per facility ────────────────────
create table if not exists public.inventory (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  qty         integer not null default 0,
  unit        text default 'units',
  low_at      integer not null default 10,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_inventory_name on public.inventory(name);

drop trigger if exists trg_inventory_updated_at on public.inventory;
create trigger trg_inventory_updated_at before update on public.inventory
  for each row execute function public.set_updated_at();

alter table public.inventory enable row level security;
drop policy if exists "inventory staff all" on public.inventory;
create policy "inventory staff all" on public.inventory
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── CLIENT_TAGS — many-to-many (client_id + tag string) ──────
create table if not exists public.client_tags (
  client_id   uuid not null references public.clients(id) on delete cascade,
  tag         text not null,
  created_at  timestamptz not null default now(),
  created_by  text,
  primary key (client_id, tag)
);
create index if not exists idx_client_tags_client on public.client_tags(client_id);
create index if not exists idx_client_tags_tag on public.client_tags(tag);

alter table public.client_tags enable row level security;
drop policy if exists "client_tags staff all" on public.client_tags;
create policy "client_tags staff all" on public.client_tags
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

notify pgrst, 'reload schema';
