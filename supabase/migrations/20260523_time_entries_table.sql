-- ============================================================
-- time_entries — billable hours tracking (moved off localStorage)
-- ============================================================
-- 2nd of 15 entities from PR #141's localStorage audit. This one's
-- the highest residual risk: if a browser cache cleared mid-week,
-- the operator's timesheet evaporated and there was no way to
-- recover it.
--
-- Schema picks "one row per timer session" with ended_at = null
-- meaning "still running." That collapses the legacy two-blob
-- design (gl_time_entries array + gl_active_timer singleton) into
-- one table and one source of truth. A partial unique index on
-- (user_id) where ended_at is null enforces at most one running
-- timer per user — no more "I started two timers on two devices"
-- bugs.
--
-- client_name is snapshotted at start time so reports stay readable
-- even if the client is later renamed or deleted (client_id sets
-- to null on cascade so the row survives).
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  client_name   text,
  activity      text,
  notes         text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  seconds       integer,
  hours         numeric(8,2),
  created_at    timestamptz not null default now()
);

-- One running timer per user. ended_at is NULL while the timer is
-- live; UPDATE sets it on stop.
create unique index if not exists uniq_active_timer_per_user
  on public.time_entries(user_id) where ended_at is null;

create index if not exists idx_time_entries_user_started
  on public.time_entries(user_id, started_at desc);
create index if not exists idx_time_entries_client
  on public.time_entries(client_id, started_at desc);

alter table public.time_entries enable row level security;

-- Each user can manage only their own rows. Admins (staff) can read
-- every row for org-wide hours reports; updates/deletes stay
-- restricted to the row owner so admins can't quietly rewrite
-- someone else's timesheet.
drop policy if exists "time_entries self select" on public.time_entries;
create policy "time_entries self select" on public.time_entries
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "time_entries staff select all" on public.time_entries;
create policy "time_entries staff select all" on public.time_entries
  for select to authenticated
  using (public.is_staff_user());

drop policy if exists "time_entries self insert" on public.time_entries;
create policy "time_entries self insert" on public.time_entries
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "time_entries self update" on public.time_entries;
create policy "time_entries self update" on public.time_entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "time_entries self delete" on public.time_entries;
create policy "time_entries self delete" on public.time_entries
  for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
