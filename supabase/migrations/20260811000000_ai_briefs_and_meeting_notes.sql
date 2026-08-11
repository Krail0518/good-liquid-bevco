-- ============================================================
-- AI deal/client briefs + checkable to-dos + meeting notes
-- ============================================================
-- Powers the "Deal Brief" (a living, incrementally-updated summary of every
-- lead/client's emails + notes) and the meeting-notes upload. All three tables
-- are polymorphic: they attach to a pipeline deal (subject_kind='deal',
-- subject_id=deals.id) OR a client (subject_kind='client', subject_id=clients.id).
-- Staff-only — these are internal working notes, never customer-visible.
--
-- ROLLBACK: drop table meeting_notes, ai_brief_todos, ai_briefs;
-- ============================================================

create table if not exists public.ai_briefs (
  id                 uuid primary key default gen_random_uuid(),
  subject_kind       text not null check (subject_kind in ('deal','client')),
  subject_id         uuid not null,
  status_text        text,
  ball               text default 'none' check (ball in ('you','them','none')),
  ball_since         timestamptz,
  key_facts          jsonb not null default '[]'::jsonb,
  summary_md         text,
  last_email_at      timestamptz,
  source_email_count integer not null default 0,
  source_note_count  integer not null default 0,
  model              text,
  stale              boolean not null default true,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (subject_kind, subject_id)
);
create index if not exists ai_briefs_subject_idx on public.ai_briefs(subject_kind, subject_id);
create index if not exists ai_briefs_stale_idx   on public.ai_briefs(stale) where stale;

create table if not exists public.ai_brief_todos (
  id            uuid primary key default gen_random_uuid(),
  subject_kind  text not null check (subject_kind in ('deal','client')),
  subject_id    uuid not null,
  body          text not null,
  owner         text not null default 'you' check (owner in ('you','them')),
  done          boolean not null default false,
  done_at       timestamptz,
  due_date      date,
  source        text not null default 'ai' check (source in ('ai','manual')),
  ai_key        text,
  created_at    timestamptz not null default now()
);
create index if not exists ai_brief_todos_subject_idx on public.ai_brief_todos(subject_kind, subject_id, done);

create table if not exists public.meeting_notes (
  id            uuid primary key default gen_random_uuid(),
  subject_kind  text not null check (subject_kind in ('deal','client')),
  subject_id    uuid not null,
  title         text,
  meeting_date  date,
  body          text,
  file_path     text,
  file_type     text,
  uploaded_by   text,
  created_at    timestamptz not null default now()
);
create index if not exists meeting_notes_subject_idx on public.meeting_notes(subject_kind, subject_id, meeting_date desc nulls last);

alter table public.ai_briefs      enable row level security;
alter table public.ai_brief_todos enable row level security;
alter table public.meeting_notes  enable row level security;

drop policy if exists "ai_briefs staff all" on public.ai_briefs;
create policy "ai_briefs staff all" on public.ai_briefs
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "ai_brief_todos staff all" on public.ai_brief_todos;
create policy "ai_brief_todos staff all" on public.ai_brief_todos
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists "meeting_notes staff all" on public.meeting_notes;
create policy "meeting_notes staff all" on public.meeting_notes
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());

notify pgrst, 'reload schema';
