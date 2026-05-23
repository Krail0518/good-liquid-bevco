-- ============================================================
-- tasks — personal to-do list per user (off localStorage)
-- ============================================================
-- 3rd of 15 entities from PR #141's localStorage audit.
--
-- Each row is one user's to-do. Different from the COMPLIANCE
-- task system (which lives in compliance_records / form_code) —
-- this is the plain "remember to do X" list reachable from the
-- ✅ Tasks sidebar item.
--
-- RLS: each user manages their own rows; admins can SELECT all
-- for visibility but not edit other users' to-dos.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  due_date    date,
  priority    text check (priority in ('high','medium','low') or priority is null),
  client_id   uuid references public.clients(id) on delete set null,
  notes       text,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_tasks_user_due
  on public.tasks(user_id, done, due_date);
create index if not exists idx_tasks_client
  on public.tasks(client_id, done);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

drop policy if exists "tasks self select" on public.tasks;
create policy "tasks self select" on public.tasks
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "tasks staff select all" on public.tasks;
create policy "tasks staff select all" on public.tasks
  for select to authenticated
  using (public.is_staff_user());

drop policy if exists "tasks self insert" on public.tasks;
create policy "tasks self insert" on public.tasks
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "tasks self update" on public.tasks;
create policy "tasks self update" on public.tasks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "tasks self delete" on public.tasks;
create policy "tasks self delete" on public.tasks
  for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
