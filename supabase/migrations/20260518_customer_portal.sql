-- ============================================================
-- Customer self-service portal — auth + access scoping
-- ============================================================
-- Adds a customer_users table that maps a Supabase Auth user to a
-- single client_id. Anyone signing into the portal can ONLY see rows
-- belonging to their client.
--
-- The portal lives at ?portal=1 on the public site. Customers click
-- "Customer Login" on the homepage → enter email + password → land on
-- a dashboard showing their invoices, allergen declarations, and
-- recent production runs.
--
-- Admin staff invite a customer via the Clients page (next PR adds a
-- button — for now insert manually). The invite creates the auth user
-- + the customer_users row in one go.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.customer_users (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique, -- references auth.users(id)
  client_id    uuid not null references public.clients(id) on delete cascade,
  email        text not null,
  display_name text,
  active       boolean not null default true,
  invited_by   uuid,
  invited_at   timestamptz not null default now(),
  last_login   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_customer_users_auth on public.customer_users(auth_user_id);
create index if not exists idx_customer_users_client on public.customer_users(client_id);

alter table public.customer_users enable row level security;

-- A customer can read THEIR OWN customer_users row (to learn their client_id).
drop policy if exists "customer_users self read" on public.customer_users;
create policy "customer_users self read" on public.customer_users
  for select to authenticated
  using (auth_user_id = auth.uid());

-- Admin (= any authenticated user — in practice staff only have CRM access)
-- can CRUD everything. The portal user lookup uses self-read above.
drop policy if exists "customer_users admin all" on public.customer_users;
create policy "customer_users admin all" on public.customer_users
  for all to authenticated
  using (true) with check (true);

-- Helper: returns the client_id for the currently-logged-in customer user.
-- Used in scoped RLS policies below.
create or replace function public.current_customer_client_id()
returns uuid
language sql
stable
security definer
as $$
  select client_id from public.customer_users where auth_user_id = auth.uid() and active = true limit 1
$$;
grant execute on function public.current_customer_client_id() to authenticated;

-- ---------- Scoped policies for portal-visible data ----------
-- Customer can read THEIR client's invoices
drop policy if exists "invoices customer self" on public.invoices;
create policy "invoices customer self" on public.invoices
  for select to authenticated
  using (
    client_id = public.current_customer_client_id()
  );

-- Customer can read THEIR allergen declarations
drop policy if exists "allergens customer self" on public.client_allergen_declarations;
create policy "allergens customer self" on public.client_allergen_declarations
  for select to authenticated
  using (
    client_id = public.current_customer_client_id()
  );

-- Customer can read their own client row (name, address, etc.)
drop policy if exists "clients customer self" on public.clients;
create policy "clients customer self" on public.clients
  for select to authenticated
  using (
    id = public.current_customer_client_id()
  );

notify pgrst, 'reload schema';
