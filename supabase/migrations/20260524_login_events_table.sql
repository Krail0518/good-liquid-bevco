-- ============================================================
-- login_events — track IP / user-agent per login, alert on new IP
-- ============================================================
-- On every successful sign-in the JS client inserts a row here.
-- If the IP is different from all previously seen IPs for that
-- user, the app shows an in-app banner and fires a Mailgun email
-- to the account holder.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.login_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ip_address    text,
  user_agent    text,
  is_new_ip     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Index for quick lookups of prior IPs per user
create index if not exists login_events_user_id_idx on public.login_events(user_id);
create index if not exists login_events_created_at_idx on public.login_events(created_at desc);

-- RLS: enable
alter table public.login_events enable row level security;

-- Users can only insert their own rows (insert happens right after auth)
drop policy if exists "login_events self insert" on public.login_events;
create policy "login_events self insert" on public.login_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- Users can read their own login history; super can read all
drop policy if exists "login_events self select" on public.login_events;
create policy "login_events self select" on public.login_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_user());

-- No update or delete via JS client — append-only audit trail
-- (Super user can delete via Supabase dashboard service-role key only)

notify pgrst, 'reload schema';
