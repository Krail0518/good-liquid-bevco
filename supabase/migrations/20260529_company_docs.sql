-- ============================================================
-- company_docs — 2026-05-29
--
-- Key/value store for editable company reference documents.
-- Currently used for capabilities_pricing (fed to Claude
-- when drafting lead outreach emails).
--
-- Idempotent — safe to re-run.
-- ============================================================

create table if not exists public.company_docs (
  key        text primary key,
  content    text not null,
  updated_at timestamptz default now()
);

alter table public.company_docs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'company_docs' and policyname = 'authed read'
  ) then
    create policy "authed read" on public.company_docs
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'company_docs' and policyname = 'authed write'
  ) then
    create policy "authed write" on public.company_docs
      for all to authenticated using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
