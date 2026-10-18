-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage — CONRI pallet numbers, pallet split, storage billing
-- ════════════════════════════════════════════════════════════════
-- 1. CONRI PALLET NUMBERS
--    CONRI keys every pallet it receives under its own number (the Receive
--    Summary Ticket, e.g. 9608) and pulls by that number, not by our GL tag.
--    wh_pallets.conri_pallet_id stores it. Unique while set, so one CONRI
--    number can never point at two of our pallets.
--
-- 2. SPLIT
--    CONRI sometimes tags what we recorded as one pallet as several. To keep
--    one CONRI number per record, wh_split_pallet() moves some cases onto a
--    new pallet record in the same place and status. It is SECURITY INVOKER,
--    so RLS decides who may call it exactly as for a direct insert/update:
--    staff only. split_from records where a split pallet came from.
--
-- 3. BILLING
--    Clients pay for their pallets at CONRI: a storage rate per pallet per
--    month (any part of a month counts) and a fee per pallet pulled out.
--    wh_billing_rates holds the rate: the row with client_id NULL is the
--    default ($30 / $15), a client row overrides it. wh_billing_statements
--    records what was billed for a client and month, so a month is not
--    billed twice and a later change shows as a difference. The amounts are
--    computed in the page from wh_movements; the statement is a snapshot.
--
-- WHO CAN SEE IT
--    Staff only, both layers, as every wh_* table (20260930120000). The two
--    billing tables are financial, so they also get "gl warehouse guard"
--    (20260817000000): a warehouse-role user cannot read or change rates or
--    statements, as with invoices. No anon or portal policy is added.
--
-- ROLLBACK:
--   drop function if exists public.wh_split_pallet(uuid, integer);
--   drop table if exists public.wh_billing_statements;
--   drop table if exists public.wh_billing_rates;
--   drop index if exists public.wh_pallets_conri_pallet_id_key;
--   alter table public.wh_pallets drop column if exists split_from;
--   alter table public.wh_pallets drop column if exists conri_pallet_id;
--   Dropping the statements loses the record of which months were billed.

set search_path = public, extensions;

-- ── 1. CONRI pallet number ───────────────────────────────────────
alter table public.wh_pallets
  add column conri_pallet_id text
    check (conri_pallet_id is null or (length(btrim(conri_pallet_id)) between 1 and 40)),
  add column split_from uuid references public.wh_pallets(id) on delete restrict;
create unique index wh_pallets_conri_pallet_id_key
  on public.wh_pallets (conri_pallet_id) where conri_pallet_id is not null;

-- ── 2. Split ─────────────────────────────────────────────────────
create or replace function public.wh_split_pallet(p_pallet uuid, p_cases integer)
returns public.wh_pallets
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_old public.wh_pallets;
  v_new public.wh_pallets;
begin
  select * into v_old from public.wh_pallets where id = p_pallet for update;
  if not found then
    raise exception 'Pallet not found.';
  end if;
  if v_old.status = 'void' then
    raise exception 'Pallet % is void.', v_old.pallet_tag;
  end if;
  if v_old.current_transfer_id is not null then
    raise exception 'Pallet % is on a transfer; split it before it is added or after the transfer completes.', v_old.pallet_tag;
  end if;
  if p_cases is null or p_cases < 1 or p_cases >= v_old.cases then
    raise exception 'Split off between 1 and % cases.', v_old.cases - 1;
  end if;

  insert into public.wh_pallets (sku_id, lot_id, cases, weight_lbs, height_in, location, status,
                                 received_at_conri, expected_pull_date, notes, split_from)
  values (v_old.sku_id, v_old.lot_id, p_cases,
          case when v_old.weight_lbs is null then null
               else greatest(round(v_old.weight_lbs * p_cases / v_old.cases, 1), 0.1) end,
          v_old.height_in, v_old.location, v_old.status,
          v_old.received_at_conri, v_old.expected_pull_date, v_old.notes, v_old.id)
  returning * into v_new;

  update public.wh_pallets
     set cases = v_old.cases - p_cases,
         weight_lbs = case when v_old.weight_lbs is null then null
                           else greatest(v_old.weight_lbs - v_new.weight_lbs, 0.1) end
   where id = v_old.id;
  if not found then
    raise exception 'Pallet % could not be updated.', v_old.pallet_tag;
  end if;
  return v_new;
end;
$fn$;
revoke all on function public.wh_split_pallet(uuid, integer) from public, anon;
grant execute on function public.wh_split_pallet(uuid, integer) to authenticated;

-- ── 3. Billing ───────────────────────────────────────────────────
create table public.wh_billing_rates (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid references public.clients(id) on delete cascade,
  storage_per_pallet_month  numeric(10,2) not null check (storage_per_pallet_month >= 0),
  pull_per_pallet           numeric(10,2) not null check (pull_per_pallet >= 0),
  updated_by                uuid default auth.uid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index wh_billing_rates_client_key on public.wh_billing_rates (client_id) nulls not distinct;
create trigger set_updated_at before update on public.wh_billing_rates
  for each row execute function public.set_updated_at();
insert into public.wh_billing_rates (client_id, storage_per_pallet_month, pull_per_pallet, updated_by)
values (null, 30, 15, null);

create table public.wh_billing_statements (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete restrict,
  period           date not null check (extract(day from period) = 1),
  storage_pallets  integer not null check (storage_pallets >= 0),
  storage_rate     numeric(10,2) not null check (storage_rate >= 0),
  pulls            integer not null check (pulls >= 0),
  pull_rate        numeric(10,2) not null check (pull_rate >= 0),
  amount           numeric(12,2) not null check (amount >= 0),
  invoice_ref      text check (invoice_ref is null or length(invoice_ref) <= 80),
  detail           jsonb not null default '{}'::jsonb,
  billed_by        uuid default auth.uid(),
  billed_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, period)
);
create trigger set_updated_at before update on public.wh_billing_statements
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['wh_billing_rates','wh_billing_statements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.is_gl_staff()) with check (public.is_gl_staff())',
      t || ' staff all', t);
    execute format(
      'create policy "gl tenant guard" on public.%I as restrictive to authenticated '
      || 'using (public.is_gl_staff()) with check (public.is_gl_staff())', t);
    execute format(
      'create policy "gl warehouse guard" on public.%I as restrictive to authenticated '
      || 'using (not public.gl_is_warehouse()) with check (not public.gl_is_warehouse())', t);
  end loop;
end $$;
grant select, insert, update, delete on public.wh_billing_rates, public.wh_billing_statements to authenticated;

notify pgrst, 'reload schema';
