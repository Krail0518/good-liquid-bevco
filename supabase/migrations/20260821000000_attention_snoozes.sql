-- ════════════════════════════════════════════════════════════════
-- Needs-Attention snooze / handled store
-- ════════════════════════════════════════════════════════════════
-- The triage board ("Needs Attention Today") let Mike snooze a lead, but the
-- board never read that state back, so addressed accounts kept reappearing.
-- This table is the single source of truth the board consults: one row per
-- (deal|client) that has been snoozed for a while or marked handled. The board
-- hides any subject whose row is handled or whose snoozed_until is in the future.
--
-- Staff-only per CLAUDE.md: no USING(true); every operation is scoped to an
-- active profiles row via is_gl_staff(). Not sensitive client data, so the
-- warehouse RESTRICTIVE guard deliberately does not list this table.
--
-- ROLLBACK: drop table if exists public.attention_snoozes;

create table if not exists public.attention_snoozes (
  subject_kind  text        not null check (subject_kind in ('deal','client')),
  subject_id    text        not null,
  snoozed_until timestamptz,
  handled       boolean     not null default false,
  updated_by    uuid        default auth.uid(),
  updated_at    timestamptz not null default now(),
  primary key (subject_kind, subject_id)
);

alter table public.attention_snoozes enable row level security;

drop policy if exists "gl staff manage attention snoozes" on public.attention_snoozes;
create policy "gl staff manage attention snoozes"
  on public.attention_snoozes
  as permissive for all
  to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

grant select, insert, update, delete on public.attention_snoozes to authenticated;

notify pgrst, 'reload schema';
