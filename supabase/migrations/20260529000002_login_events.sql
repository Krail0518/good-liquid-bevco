-- ============================================================
-- login_events — 2026-05-29
--
-- Records every CRM login with IP address and user-agent for
-- the new-sign-in-location security alert feature in fix.js.
--
-- Idempotent — safe to re-run.
-- ============================================================

create table if not exists public.login_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  ip_address  text,
  user_agent  text,
  is_new_ip   boolean default false,
  created_at  timestamptz default now()
);

-- Only the row's owner can read their own login events.
-- Admins (service role) can read all.
alter table public.login_events enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'login_events' and policyname = 'owner read'
  ) then
    create policy "owner read" on public.login_events
      for select to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'login_events' and policyname = 'owner insert'
  ) then
    create policy "owner insert" on public.login_events
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;
end $$;

-- Index for the "have I seen this IP before?" lookup
create index if not exists login_events_user_ip_idx
  on public.login_events (user_id, ip_address);

notify pgrst, 'reload schema';
