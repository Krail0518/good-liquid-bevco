-- ============================================================
-- announcements + notifications — feed data (off localStorage)
-- ============================================================
-- 4th + 5th of 15 entities. Both are message-feed style data
-- that was previously per-device — meaning announcements posted
-- by one user weren't visible to anyone else, and notification
-- read state didn't sync across devices.
--
-- announcements is team-wide (any staff can post + read).
-- notifications is per-user (each user has their own inbox).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── ANNOUNCEMENTS — team broadcast board ────────────────────────
create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  body          text not null,
  author_id     uuid references auth.users(id) on delete set null,
  author_name   text,
  author_email  text,
  pinned        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_announcements_created on public.announcements(pinned desc, created_at desc);

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

drop policy if exists "announcements staff select" on public.announcements;
create policy "announcements staff select" on public.announcements
  for select to authenticated using (public.is_staff_user());

drop policy if exists "announcements staff insert" on public.announcements;
create policy "announcements staff insert" on public.announcements
  for insert to authenticated with check (public.is_staff_user());

drop policy if exists "announcements author update" on public.announcements;
create policy "announcements author update" on public.announcements
  for update to authenticated
  using (author_id = auth.uid() or (auth.jwt() ->> 'email') = author_email)
  with check (author_id = auth.uid() or (auth.jwt() ->> 'email') = author_email);

drop policy if exists "announcements admin delete" on public.announcements;
create policy "announcements admin delete" on public.announcements
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or author_id = auth.uid()
  );

-- ── NOTIFICATIONS — per-user inbox ─────────────────────────────
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  sub           text,
  type          text default 'info',  -- info / success / warning / stale / reminder / email
  read          boolean not null default false,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications self select" on public.notifications;
create policy "notifications self select" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "notifications self insert" on public.notifications;
create policy "notifications self insert" on public.notifications
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "notifications self update" on public.notifications;
create policy "notifications self update" on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications self delete" on public.notifications;
create policy "notifications self delete" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
