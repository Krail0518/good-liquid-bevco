-- ============================================================
-- Phase 4 — SQL-backed compliance enhancements
-- ============================================================
-- Four optional enhancements that need schema changes.
-- Each block is independent; you can skip any you don't need.
-- Re-running is safe (idempotent).
-- ============================================================

-- ============================================================
-- (10) Multi-PCQI sign-off
-- ============================================================
-- Adds a second signature on compliance_records so the same record
-- can be signed by Mike (PCQI) AND, optionally, a backup PCQI.
-- Used for high-risk records (CCP deviations, hold dispositions).
alter table public.compliance_records add column if not exists second_signed_by      uuid;
alter table public.compliance_records add column if not exists second_signed_at      timestamptz;
alter table public.compliance_records add column if not exists second_signature_name text;

-- ============================================================
-- (11) Inspector read-only mode
-- ============================================================
-- One-time tokens you hand to an FDA inspector. The token opens
-- the CRM in a read-only mode (no edits, no exports, no signatures).
-- Each token is bound to a date window and is invalidated after.
create table if not exists public.inspector_tokens (
  id            uuid primary key default gen_random_uuid(),
  token         text unique not null,
  inspector     text not null,
  agency        text,
  purpose       text,
  valid_from    timestamptz not null default now(),
  valid_until   timestamptz not null,
  created_by    uuid,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  use_count     integer not null default 0,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_inspector_tokens_token  on public.inspector_tokens(token);
create index if not exists idx_inspector_tokens_window on public.inspector_tokens(valid_from, valid_until);

alter table public.inspector_tokens enable row level security;
drop policy if exists "inspector_tokens authed" on public.inspector_tokens;
create policy "inspector_tokens authed" on public.inspector_tokens
  for all to authenticated using (true);
-- Anonymous read so the inspector URL works without login:
drop policy if exists "inspector_tokens anon read" on public.inspector_tokens;
create policy "inspector_tokens anon read" on public.inspector_tokens
  for select to anon using (revoked_at is null and now() between valid_from and valid_until);

-- ============================================================
-- (16) Multi-facility scoping
-- ============================================================
-- Tags compliance records, tasks, and hold tags with a facility code.
-- Today Good Liquid is single-facility (GL-PALMETTO); this lets you
-- spin up a second co-packer location without forking the schema.
create table if not exists public.facilities (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  address       text,
  fda_registration text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into public.facilities (code, name, address)
  values ('GL-PALMETTO', 'Good Liquid Bev Co — Palmetto', 'Palmetto, FL')
  on conflict (code) do nothing;

alter table public.compliance_records add column if not exists facility_id uuid references public.facilities(id);
alter table public.compliance_tasks   add column if not exists facility_id uuid references public.facilities(id);
alter table public.hold_tags          add column if not exists facility_id uuid references public.facilities(id);

create index if not exists idx_compliance_records_facility on public.compliance_records(facility_id);
create index if not exists idx_compliance_tasks_facility   on public.compliance_tasks(facility_id);
create index if not exists idx_hold_tags_facility          on public.hold_tags(facility_id);

-- Backfill existing rows to the Palmetto facility:
update public.compliance_records set facility_id = (select id from public.facilities where code = 'GL-PALMETTO') where facility_id is null;
update public.compliance_tasks   set facility_id = (select id from public.facilities where code = 'GL-PALMETTO') where facility_id is null;
update public.hold_tags          set facility_id = (select id from public.facilities where code = 'GL-PALMETTO') where facility_id is null;

alter table public.facilities enable row level security;
drop policy if exists "facilities authed" on public.facilities;
create policy "facilities authed" on public.facilities
  for all to authenticated using (true);

-- ============================================================
-- (17) Customer-managed allergen declarations
-- ============================================================
-- Each client/customer can declare the allergens in *their* product
-- separately from the master allergen matrix on the recipe. Gives
-- co-pack customers a controlled place to assert their own labeling
-- claims (Gluten-Free, Vegan, etc.) without editing recipes.
create table if not exists public.client_allergen_declarations (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  product_name    text not null,
  allergens       jsonb not null default '{}'::jsonb,
  -- Example JSONB shape:
  --   { "milk": false, "eggs": false, "fish": false, "shellfish": false,
  --     "tree_nuts": false, "peanuts": false, "wheat": false, "soybeans": false,
  --     "sesame": false, "gluten_free_claim": true, "vegan_claim": true }
  claims          text[],
  declared_by     text,
  declared_at     timestamptz not null default now(),
  effective_date  date,
  notes           text,
  share_token     text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_client_allergens_client on public.client_allergen_declarations(client_id);
create index if not exists idx_client_allergens_token  on public.client_allergen_declarations(share_token);
create index if not exists idx_client_allergens_data   on public.client_allergen_declarations using gin (allergens);

drop trigger if exists trg_client_allergens_updated on public.client_allergen_declarations;
create trigger trg_client_allergens_updated before update on public.client_allergen_declarations
  for each row execute function public.set_updated_at();

alter table public.client_allergen_declarations enable row level security;
drop policy if exists "client_allergens authed" on public.client_allergen_declarations;
create policy "client_allergens authed" on public.client_allergen_declarations
  for all to authenticated using (true);
-- Anon read by share_token so the customer's portal link works without login:
drop policy if exists "client_allergens anon by token" on public.client_allergen_declarations;
create policy "client_allergens anon by token" on public.client_allergen_declarations
  for select to anon using (share_token is not null);
