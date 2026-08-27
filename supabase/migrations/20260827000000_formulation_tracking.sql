-- ════════════════════════════════════════════════════════════════
-- Formulation tracking — who formulated, and what the brand spent
-- ════════════════════════════════════════════════════════════════
-- Mike refers brands out to third-party formulation houses (Lotus Nutra
-- today, others later) and needs to record, per lead and per client:
--   • that formulation happened at all       → formulation_done
--   • which house did it                     → formulation_vendor
--   • what the brand spent with that house   → formulation_spend
--
-- The house list lives in its own table rather than a hard-coded array so
-- staff can add formulators from the CRM without a migration. The vendor is
-- stored on deals/clients as TEXT (the house's name), not a foreign key:
-- renaming or retiring a formulator must not rewrite or orphan historical
-- rows, and the dropdown is what keeps the spelling consistent.
--
-- formulators is staff-only business config: no anon, no portal customer.
-- Read/write are both scoped to public.is_gl_staff() (an active profiles
-- row), and writes additionally exclude viewers, matching how every other
-- staff-editable table in this schema is gated. The new columns on
-- deals/clients inherit those tables' existing policies, including the
-- restrictive "gl tenant guard" — portal customers cannot reach deals at
-- all, and see only their own clients row.
--
-- ROLLBACK:
--   alter table public.clients drop column if exists formulation_done,
--     drop column if exists formulation_vendor, drop column if exists formulation_spend;
--   alter table public.deals drop column if exists formulation_done,
--     drop column if exists formulation_vendor, drop column if exists formulation_spend;
--   drop table if exists public.formulators;

-- ── The formulation houses staff can pick from ──────────────────────────────
create table if not exists public.formulators (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.formulators enable row level security;

drop policy if exists "formulators staff read"   on public.formulators;
drop policy if exists "formulators staff insert" on public.formulators;
drop policy if exists "formulators staff update" on public.formulators;
create policy "formulators staff read" on public.formulators
  for select to authenticated using (public.is_gl_staff());
create policy "formulators staff insert" on public.formulators
  for insert to authenticated
  with check (public.is_gl_staff() and not public.gl_is_viewer());
create policy "formulators staff update" on public.formulators
  for update to authenticated
  using (public.is_gl_staff() and not public.gl_is_viewer())
  with check (public.is_gl_staff() and not public.gl_is_viewer());

grant select, insert, update on public.formulators to authenticated;

-- Seed the one house in use today. Idempotent on the unique name.
insert into public.formulators (name, sort_order) values ('Lotus Nutra', 10)
on conflict (name) do nothing;

-- ── Per-record formulation fields ───────────────────────────────────────────
-- numeric(12,2): dollars-and-cents, up to 9,999,999,999.99 — a float would
-- round money.
alter table public.deals
  add column if not exists formulation_done   boolean not null default false,
  add column if not exists formulation_vendor text,
  add column if not exists formulation_spend  numeric(12,2);

alter table public.clients
  add column if not exists formulation_done   boolean not null default false,
  add column if not exists formulation_vendor text,
  add column if not exists formulation_spend  numeric(12,2);

-- Spend is a dollar figure, never negative.
alter table public.deals   drop constraint if exists deals_formulation_spend_nonneg;
alter table public.clients drop constraint if exists clients_formulation_spend_nonneg;
alter table public.deals
  add constraint deals_formulation_spend_nonneg
  check (formulation_spend is null or formulation_spend >= 0);
alter table public.clients
  add constraint clients_formulation_spend_nonneg
  check (formulation_spend is null or formulation_spend >= 0);

notify pgrst, 'reload schema';
