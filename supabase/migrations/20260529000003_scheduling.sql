-- ============================================================
-- scheduling — 2026-05-29
--
-- Two tables powering the "Share Your Calendar" / Scheduling Link
-- feature:
--
--   booking_pages  — per-user availability config (one row per rep).
--                    Anon-readable so the public book.html page can
--                    load settings without requiring a login.
--
--   bookings       — individual appointments created when a visitor
--                    books a slot via the public page.
--                    Anon-readable (confirmed only) for slot-
--                    availability checks; all writes go through the
--                    booking-confirm Edge Function which uses the
--                    service-role key.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ── booking_pages ─────────────────────────────────────────────────
create table if not exists public.booking_pages (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  slug         text        unique not null,           -- URL slug  e.g. "mike"
  title        text        not null default 'Schedule a meeting',
  description  text,
  duration     int         not null default 30,       -- minutes: 15 / 30 / 60
  buffer_after int         not null default 10,       -- buffer after each meeting (min)
  timezone     text        not null default 'America/New_York',
  avail_days   int[]       not null default '{1,2,3,4,5}',  -- 0=Sun … 6=Sat
  start_time   text        not null default '09:00',  -- "HH:MM" 24-h
  end_time     text        not null default '17:00',
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_booking_pages_slug    on public.booking_pages(slug);
create index if not exists idx_booking_pages_user_id on public.booking_pages(user_id);

drop trigger if exists trg_booking_pages_updated_at on public.booking_pages;
create trigger trg_booking_pages_updated_at
  before update on public.booking_pages
  for each row execute function public.set_updated_at();

alter table public.booking_pages enable row level security;

do $$ begin
  -- Staff manage their own page
  if not exists (
    select 1 from pg_policies
    where tablename = 'booking_pages' and policyname = 'booking_pages owner all'
  ) then
    create policy "booking_pages owner all" on public.booking_pages
      for all to authenticated
      using  (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  -- Public (anon) can read active pages — needed by book.html
  if not exists (
    select 1 from pg_policies
    where tablename = 'booking_pages' and policyname = 'booking_pages anon read'
  ) then
    create policy "booking_pages anon read" on public.booking_pages
      for select to anon
      using (is_active = true);
  end if;
end $$;


-- ── bookings ──────────────────────────────────────────────────────
create table if not exists public.bookings (
  id               uuid        primary key default gen_random_uuid(),
  page_id          uuid        not null references public.booking_pages(id) on delete cascade,
  cal_event_id     uuid        references public.cal_events(id) on delete set null,
  booker_name      text        not null,
  booker_email     text        not null,
  booker_company   text,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  notes            text,
  status           text        not null default 'confirmed',  -- confirmed | cancelled
  created_at       timestamptz not null default now()
);

create index if not exists idx_bookings_page_id   on public.bookings(page_id);
create index if not exists idx_bookings_start_at  on public.bookings(start_at);
create index if not exists idx_bookings_status    on public.bookings(status);

alter table public.bookings enable row level security;

do $$ begin
  -- Page owner (authenticated) can read + cancel their bookings
  if not exists (
    select 1 from pg_policies
    where tablename = 'bookings' and policyname = 'bookings owner all'
  ) then
    create policy "bookings owner all" on public.bookings
      for all to authenticated
      using (
        page_id in (
          select id from public.booking_pages where user_id = auth.uid()
        )
      )
      with check (
        page_id in (
          select id from public.booking_pages where user_id = auth.uid()
        )
      );
  end if;

  -- Anon can read confirmed bookings to check slot availability
  if not exists (
    select 1 from pg_policies
    where tablename = 'bookings' and policyname = 'bookings anon read confirmed'
  ) then
    create policy "bookings anon read confirmed" on public.bookings
      for select to anon
      using (status = 'confirmed');
  end if;

  -- Anon CANNOT insert directly — all writes go through the
  -- booking-confirm Edge Function which uses the service-role key.
end $$;

notify pgrst, 'reload schema';
