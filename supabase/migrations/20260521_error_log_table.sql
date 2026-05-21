-- ============================================================
-- error_log table — backs the in-app error capturer
-- ============================================================
-- The error logger in fix.js (around line 6115) attaches window
-- 'error' + 'unhandledrejection' listeners and POSTs caught
-- exceptions to /rest/v1/error_log. Without this table in prod,
-- every captured error fires a 404 in the browser console (the
-- POST is keepalive + try/catch wrapped so it doesn't break the
-- app, but the 404 noise drowns out real signal).
--
-- The original help-guide instructions told the operator to copy
-- a one-click SQL from the System Health widget. This migration
-- replaces that manual step by shipping the schema in the repo so
-- fresh Supabase projects always have it.
--
-- Caught via Playwright runtime audit on 2026-05-21.
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.error_log (
  id            uuid primary key default gen_random_uuid(),
  actor_email   text,
  message       text not null,
  source        text,
  line_no       integer,
  col_no        integer,
  stack         text,
  user_agent    text,
  url           text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_error_log_created_at on public.error_log(created_at desc);
create index if not exists idx_error_log_actor      on public.error_log(actor_email);

alter table public.error_log enable row level security;

-- Anyone authenticated can INSERT (the in-app capturer fires for
-- staff AND portal users — both need to be able to log their own
-- exceptions). Staff can SELECT all; portal customers can only
-- SELECT their own rows.
drop policy if exists "error_log insert anyone authed" on public.error_log;
create policy "error_log insert anyone authed" on public.error_log
  for insert to authenticated
  with check (true);

drop policy if exists "error_log staff select" on public.error_log;
create policy "error_log staff select" on public.error_log
  for select to authenticated
  using (public.is_staff_user());

drop policy if exists "error_log self select" on public.error_log;
create policy "error_log self select" on public.error_log
  for select to authenticated
  using (actor_email = (auth.jwt() ->> 'email'));

notify pgrst, 'reload schema';
