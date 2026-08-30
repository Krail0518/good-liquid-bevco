-- ============================================================
-- client_notes — per-client sticky notes (moved off localStorage)
-- ============================================================
-- Mike's audit on 2026-05-22 flagged 15 entities still persisting
-- only to localStorage. Client notes were the highest priority to
-- migrate because they're (a) actual business data (not UI prefs),
-- (b) currently per-device (Mike's notes on his laptop aren't
-- visible from his phone), and (c) lost the moment the browser
-- cache is cleared.
--
-- Schema mirrors the localStorage shape ({ text, date, author })
-- but replaces the localized `date` string with a real timestamptz,
-- and adds an author_email so audit history survives across
-- name-changes.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.client_notes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  body          text not null,
  author_email  text,
  author_name   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_client_notes_client    on public.client_notes(client_id, created_at desc);
create index if not exists idx_client_notes_created   on public.client_notes(created_at desc);

drop trigger if exists trg_client_notes_updated_at on public.client_notes;
create trigger trg_client_notes_updated_at before update on public.client_notes
  for each row execute function public.set_updated_at();

alter table public.client_notes enable row level security;

-- Staff can read + write notes on any client. Portal customers
-- never see this table at all (the notes are written ABOUT them,
-- not BY them; surfacing this to the brand would be a confidentiality
-- breach).
drop policy if exists "client_notes staff select" on public.client_notes;
create policy "client_notes staff select" on public.client_notes
  for select to authenticated
  using (public.is_staff_user());

drop policy if exists "client_notes staff insert" on public.client_notes;
create policy "client_notes staff insert" on public.client_notes
  for insert to authenticated
  with check (public.is_staff_user());

drop policy if exists "client_notes staff update" on public.client_notes;
create policy "client_notes staff update" on public.client_notes
  for update to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists "client_notes staff delete" on public.client_notes;
create policy "client_notes staff delete" on public.client_notes
  for delete to authenticated
  using (public.is_staff_user());

notify pgrst, 'reload schema';
