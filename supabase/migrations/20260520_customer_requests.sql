-- ============================================================
-- Customer Requests — inbox for portal-submitted requests
-- ============================================================
-- Customers can ask for samples, reorders, quotes, or general
-- questions from the portal. Each submission lands here for Mike
-- to triage.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.customer_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete cascade,
  submitted_by uuid,                                  -- auth.users.id of the portal customer
  kind         text not null default 'other'
               check (kind in ('sample','reorder','quote','question','other')),
  subject      text,
  body         text,
  status       text not null default 'new'
               check (status in ('new','in_progress','resolved','dismissed')),
  resolved_at  timestamptz,
  resolved_by  uuid,
  resolution_notes text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_customer_requests_client on public.customer_requests(client_id, created_at desc);
create index if not exists idx_customer_requests_status on public.customer_requests(status, created_at desc);

alter table public.customer_requests enable row level security;

-- Staff can see + manage everything.
drop policy if exists "customer_requests staff all" on public.customer_requests;
create policy "customer_requests staff all" on public.customer_requests
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- A portal customer can see their OWN client's requests and insert new ones.
drop policy if exists "customer_requests customer read" on public.customer_requests;
create policy "customer_requests customer read" on public.customer_requests
  for select to authenticated
  using (client_id = public.current_customer_client_id());

drop policy if exists "customer_requests customer insert" on public.customer_requests;
create policy "customer_requests customer insert" on public.customer_requests
  for insert to authenticated
  with check (client_id = public.current_customer_client_id());

-- Add to realtime publication so the CRM banner updates live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='customer_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.customer_requests';
  end if;
end $$;
alter table public.customer_requests replica identity full;

notify pgrst, 'reload schema';
