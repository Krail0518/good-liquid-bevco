-- ROLLBACK:
--   None, deliberately. This file only ADDS objects that production already
--   has, using `if not exists` throughout, so it changes nothing there. On a
--   fresh database, rolling it back would mean dropping clients, invoices,
--   deals and profiles — i.e. the whole application. If you need to undo it,
--   drop the database.
--
-- GL-055 — ten core tables existed in production but in NO migration.
--
-- HOW THIS WAS FOUND
-- A staging project was created and the migration history replayed into it.
-- It failed on the FIRST migration:
--
--     ERROR: relation "public.profiles" does not exist
--
-- Comparing production's 91 public tables against every `create table` in
-- supabase/migrations/ gave the answer: 81 are created by migrations, ten are
-- not. They are not peripheral —
--
--     profiles     clients     invoices    deals        activity
--     referrals    referrers   sales_decks bottling_rates  canning_rates
--
-- profiles is the table public.is_gl_staff() reads. Every staff RLS policy in
-- this system rests on a table the repository never creates.
--
-- WHY IT MATTERS BEYOND STAGING
-- The migration history could not rebuild this database. Restoring from the
-- repository alone was impossible and nobody would have discovered that until
-- they needed it. This is the same shape as the 2026-05-18 incident CLAUDE.md
-- describes — things applied by hand that appear in no migration and that
-- reading the repo can never reveal — except these are TABLES, not policies.
--
-- WHAT THIS IS
-- The DDL below was read out of production's catalogs (pg_attribute,
-- pg_constraint, pg_get_expr, pg_get_constraintdef), not written from memory,
-- so column order, defaults, check constraints and foreign keys match what is
-- actually there. It is dated BEFORE the first existing migration so a rebuild
-- runs it first.
--
-- IDEMPOTENT ON PURPOSE
-- Every table is `if not exists` and every constraint is added only when
-- absent, because this file will be re-run against a production database that
-- already has all of it. It must be a no-op there.

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- uuid_generate_v4() lives in `extensions`, which is where production has it —
-- checked, not assumed. Column DEFAULTS have to resolve the name at CREATE
-- time, so the schema must be on the search_path here or every `default
-- uuid_generate_v4()` below fails with "function does not exist".
--
-- Set rather than qualified as extensions.uuid_generate_v4(): a stored default
-- renders back unqualified when its schema is on the path, so this keeps a
-- rebuilt database rendering identically to production instead of introducing
-- cosmetic drift in every catalog comparison.
set search_path = public, extensions;

-- The two rate tables use integer keys backed by sequences.
create sequence if not exists public.bottling_rates_id_seq;
create sequence if not exists public.canning_rates_id_seq;

-- ── Tables, in dependency order ───────────────────────────────────────
-- referrers before clients (clients.referred_by), profiles and clients before
-- activity / deals / invoices.

create table if not exists public.profiles (
  id uuid not null,
  name text not null,
  email text not null,
  role text default 'sales'::text not null,
  status text default 'active'::text not null,
  initials text,
  color text default '#1a3a6e'::text,
  tc text default '#9FE1CB'::text,
  last_login timestamp with time zone,
  created_at timestamp with time zone default now(),
  notify_daily_digest boolean default true not null,
  updated_at timestamp with time zone default now() not null,
  is_super_user boolean default false not null
);

create table if not exists public.referrers (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  relationship text,
  email text,
  phone text,
  default_rate numeric default 5,
  color text default '#1a3a6e'::text,
  tc text default '#9FE1CB'::text,
  initials text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.clients (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  contact_name text,
  email text,
  phone text,
  company text,
  service text,
  status text default 'lead'::text,
  referred_by uuid,
  notes text,
  total_billed numeric default 0,
  color text default '#1a3a6e'::text,
  tc text default '#9FE1CB'::text,
  initials text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  street text,
  city text,
  state text,
  zip text,
  comm_prefs text[] default ARRAY['email'::text],
  legal_name text,
  ein text,
  website text,
  billing_same boolean default true,
  billing_street text,
  billing_city text,
  billing_state text,
  billing_zip text,
  payment_terms text default 'Due on receipt'::text,
  account_owner text,
  product_types text[],
  coi_on_file boolean default false,
  coi_expires date,
  w9_on_file boolean default false,
  w9_received date,
  stripe_customer_id text,
  qbo_customer_id text,
  pa_letter_on_file boolean default false,
  pa_letter_expires date,
  pa_letter_file_path text,
  acquired_at date,
  contact_birthday date,
  contact_type text,
  shipping_same boolean default true not null,
  shipping_street text,
  shipping_city text,
  shipping_state text,
  shipping_zip text,
  lift_gate boolean default false not null,
  dock_days text[],
  dock_hours text,
  payment_method text,
  lead_source text,
  w9_file_path text,
  tax_exempt boolean default false not null,
  tax_exempt_state text,
  tax_exempt_file_path text,
  additional_emails jsonb default '[]'::jsonb not null,
  notify_overdue_sms boolean default false not null,
  credit_limit numeric(12,2),
  onboarding_status text,
  formulation_done boolean default false not null,
  formulation_vendor text,
  formulation_spend numeric(12,2),
  formulation_pct numeric(5,2)
);

create table if not exists public.deals (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  client_id uuid,
  client_name text,
  value numeric default 0,
  stage text default 'Prospecting'::text,
  probability integer default 20,
  notes text,
  assigned_to uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  outcome_reason text,
  outcome_value numeric default 0,
  outcome_notes text,
  closed_at timestamp with time zone,
  co text,
  val numeric,
  prob numeric,
  contact_name text,
  email text,
  phone text,
  city text,
  state text,
  service text,
  product_type text,
  volume text,
  timeline text,
  funding_stage text,
  lead_source text,
  outreach_status text,
  outreach_at timestamp with time zone,
  stage_entered_at timestamp with time zone,
  first_response_at timestamp with time zone,
  sla_alerted_at timestamp with time zone,
  snoozed_until timestamp with time zone,
  handled_at timestamp with time zone,
  formulation_done boolean default false not null,
  formulation_vendor text,
  formulation_spend numeric(12,2),
  formulation_pct numeric(5,2)
);

create table if not exists public.invoices (
  id uuid default uuid_generate_v4() not null,
  invoice_number text not null,
  client_id uuid,
  client_name text not null,
  service text not null,
  amount numeric default 0 not null,
  status text default 'draft'::text,
  invoice_date date default CURRENT_DATE,
  due_date date,
  notes text,
  line_items jsonb default '[]'::jsonb,
  created_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  payment_terms text,
  share_token text,
  paid_at timestamp with time zone,
  stripe_session_id text,
  paid_method text,
  paid_amount numeric(12,2),
  waive_card_surcharge boolean default false not null,
  stripe_payment_link text,
  po_number text,
  voided_at timestamp with time zone,
  void_reason text,
  is_credit_memo boolean default false
);

create table if not exists public.activity (
  id uuid default uuid_generate_v4() not null,
  type text not null,
  title text not null,
  detail text,
  related_client uuid,
  created_by uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.referrals (
  id uuid default uuid_generate_v4() not null,
  referrer_id uuid,
  client_name text not null,
  deal_value numeric default 0,
  commission_rate numeric default 5,
  commission_amount numeric default 0,
  status text default 'lead'::text,
  date_paid date,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  amount numeric
);

create table if not exists public.bottling_rates (
  id integer default nextval('public.bottling_rates_id_seq'::regclass) not null,
  format text not null,
  format_label text not null,
  min_units integer not null,
  price_per_unit numeric(6,4) not null,
  updated_at timestamp without time zone default now()
);

create table if not exists public.canning_rates (
  id integer default nextval('public.canning_rates_id_seq'::regclass) not null,
  format text not null,
  format_label text not null,
  min_cases integer not null,
  price_per_can numeric(6,4) not null,
  updated_at timestamp without time zone default now()
);

create table if not exists public.sales_decks (
  id uuid default gen_random_uuid() not null,
  key text not null,
  label text not null,
  filename text not null,
  storage_path text,
  active boolean default true not null,
  sort_order integer default 0 not null,
  size_bytes bigint,
  uploaded_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

-- ── Constraints ───────────────────────────────────────────────────────
-- Added only when absent. `alter table ... add constraint` has no IF NOT
-- EXISTS, and this file must be a no-op against production.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('profiles',       'profiles_pkey',                    'PRIMARY KEY (id)'),
      ('profiles',       'profiles_email_key',               'UNIQUE (email)'),
      ('profiles',       'profiles_id_fkey',                 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('profiles',       'profiles_role_check',              'CHECK ((role = ANY (ARRAY[''admin''::text, ''sales''::text, ''viewer''::text, ''warehouse''::text])))'),
      ('profiles',       'profiles_status_check',            'CHECK ((status = ANY (ARRAY[''active''::text, ''inactive''::text])))'),

      ('referrers',      'referrers_pkey',                   'PRIMARY KEY (id)'),

      ('clients',        'clients_pkey',                     'PRIMARY KEY (id)'),
      ('clients',        'clients_referred_by_fkey',         'FOREIGN KEY (referred_by) REFERENCES public.referrers(id) ON DELETE SET NULL'),
      ('clients',        'clients_status_check',             'CHECK ((status = ANY (ARRAY[''active''::text, ''lead''::text, ''inactive''::text])))'),
      ('clients',        'clients_formulation_pct_range',    'CHECK (((formulation_pct IS NULL) OR ((formulation_pct >= (0)::numeric) AND (formulation_pct <= (100)::numeric))))'),
      ('clients',        'clients_formulation_spend_nonneg', 'CHECK (((formulation_spend IS NULL) OR (formulation_spend >= (0)::numeric)))'),

      ('deals',          'deals_pkey',                       'PRIMARY KEY (id)'),
      ('deals',          'deals_client_id_fkey',             'FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL'),
      ('deals',          'deals_assigned_to_fkey',           'FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL'),
      ('deals',          'deals_stage_check',                'CHECK ((stage = ANY (ARRAY[''Prospecting''::text, ''Proposal''::text, ''Negotiation''::text, ''Closed Won''::text, ''Closed Lost''::text])))'),
      ('deals',          'deals_outreach_status_check',      'CHECK (((outreach_status IS NULL) OR (outreach_status = ANY (ARRAY[''sent''::text, ''replied''::text, ''no_response''::text]))))'),
      ('deals',          'deals_formulation_pct_range',      'CHECK (((formulation_pct IS NULL) OR ((formulation_pct >= (0)::numeric) AND (formulation_pct <= (100)::numeric))))'),
      ('deals',          'deals_formulation_spend_nonneg',   'CHECK (((formulation_spend IS NULL) OR (formulation_spend >= (0)::numeric)))'),

      -- invoices_invoice_number_key is the UNIQUE constraint that EXT-024 found
      -- in production and in no migration file. It is why duplicate invoice
      -- numbers were never actually possible.
      ('invoices',       'invoices_pkey',                    'PRIMARY KEY (id)'),
      ('invoices',       'invoices_invoice_number_key',      'UNIQUE (invoice_number)'),
      ('invoices',       'invoices_client_id_fkey',          'FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL'),
      ('invoices',       'invoices_created_by_fkey',         'FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL'),
      ('invoices',       'invoices_status_check',            'CHECK ((status = ANY (ARRAY[''draft''::text, ''pending''::text, ''paid''::text, ''overdue''::text])))'),

      ('activity',       'activity_pkey',                    'PRIMARY KEY (id)'),
      ('activity',       'activity_related_client_fkey',     'FOREIGN KEY (related_client) REFERENCES public.clients(id) ON DELETE SET NULL'),
      ('activity',       'activity_created_by_fkey',         'FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL'),
      ('activity',       'activity_type_check',              'CHECK ((type = ANY (ARRAY[''call''::text, ''email''::text, ''deal''::text, ''note''::text, ''ref''::text, ''invoice''::text])))'),

      ('referrals',      'referrals_pkey',                   'PRIMARY KEY (id)'),
      ('referrals',      'referrals_referrer_id_fkey',       'FOREIGN KEY (referrer_id) REFERENCES public.referrers(id) ON DELETE CASCADE'),
      ('referrals',      'referrals_status_check',           'CHECK ((status = ANY (ARRAY[''pending''::text, ''won''::text, ''lost''::text, ''paid''::text])))'),

      ('bottling_rates', 'bottling_rates_pkey',              'PRIMARY KEY (id)'),
      ('canning_rates',  'canning_rates_pkey',               'PRIMARY KEY (id)'),

      ('sales_decks',    'sales_decks_pkey',                 'PRIMARY KEY (id)'),
      ('sales_decks',    'sales_decks_key_key',              'UNIQUE (key)')
    ) as v(tbl, name, def)
  loop
    if not exists (
      select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
      where cl.relname = c.tbl and con.conname = c.name
    ) then
      execute format('alter table public.%I add constraint %I %s', c.tbl, c.name, c.def);
    end if;
  end loop;
end $$;

-- The sequences belong to their tables, so dropping a table takes its sequence.
alter sequence public.bottling_rates_id_seq owned by public.bottling_rates.id;
alter sequence public.canning_rates_id_seq  owned by public.canning_rates.id;

-- RLS is enabled here so a rebuilt database is never briefly open. The POLICIES
-- come from the migrations that follow; enabling RLS with no policy denies
-- everything, which is the safe direction to fail.
alter table public.profiles       enable row level security;
alter table public.referrers      enable row level security;
alter table public.clients        enable row level security;
alter table public.deals          enable row level security;
alter table public.invoices       enable row level security;
alter table public.activity       enable row level security;
alter table public.referrals      enable row level security;
alter table public.bottling_rates enable row level security;
alter table public.canning_rates  enable row level security;
alter table public.sales_decks    enable row level security;

-- ── Staff-identity helper functions ───────────────────────────────────
-- Same problem as the tables above, one layer down. Three of these are used by
-- RLS policies in migrations that run BEFORE the migration which creates them
-- (is_staff_user from 20260519_followup_acks_waivers, is_admin_user from
-- 20260519_permissions_audit, is_super_user from 20260523_lock_critical_tables_
-- delete), and two — gl_is_viewer and admin_set_user_password — are created by
-- no migration at all.
--
-- They belong here for the same reason profiles does: everything else rests on
-- them. Defined with CREATE OR REPLACE so the later migrations that also define
-- them still win, leaving production's final state unchanged.
--
-- Bodies read out of production with pg_get_functiondef, not written from
-- memory. All are SECURITY DEFINER with a pinned search_path, which is what
-- lets an ordinary user ask "am I staff?" without being able to read profiles.

create or replace function public.is_staff_user()
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and coalesce(p.status, 'active') <> 'inactive'
  );
$fn$;

create or replace function public.is_admin_user()
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$fn$;

create or replace function public.is_super_user()
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select coalesce((select is_super_user from public.profiles where id = auth.uid()), false);
$fn$;

create or replace function public.gl_is_viewer()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'viewer'
      and coalesce(p.status, 'active') <> 'inactive'
  );
$fn$;

create or replace function public.gl_is_warehouse()
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.status, 'active') <> 'inactive'
      and p.role = 'warehouse'
  );
$fn$;

-- Resets a user's password. Admin-only, checked INSIDE the function — it is
-- SECURITY DEFINER and writes auth.users, so the role check is the only thing
-- standing between any authenticated user and every account's password.
create or replace function public.admin_set_user_password(target_email text, new_password text)
returns text language plpgsql security definer set search_path to 'public', 'auth'
as $fn$
declare
  caller_role text;
  target_id uuid;
begin
  if auth.uid() is null then return 'error: not authenticated'; end if;

  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is distinct from 'admin' then
    return 'error: admin only';
  end if;

  if length(new_password) < 6 then
    return 'error: password too short (min 6)';
  end if;

  select id into target_id from auth.users where lower(email) = lower(target_email);
  if target_id is null then
    return 'error: user not found';
  end if;

  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf')),
         updated_at         = now()
   where id = target_id;

  return 'ok';
end;
$fn$;
