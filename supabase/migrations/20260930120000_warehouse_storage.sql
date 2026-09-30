-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage — pallets held at CONRI Services (3PL, Palmetto)
-- ════════════════════════════════════════════════════════════════
-- Good Liquid stores two kinds of pallet at CONRI under ONE Good Liquid
-- account: overflow EMPTY CANS (1-2 days, floor stacked, come back for the run)
-- and FINISHED GOODS (after QA release, wait for a carrier pickup). This is the
-- system of record for where every pallet is, and the paperwork for each move.
--
-- WHO CAN SEE IT
-- --------------
-- Staff only. Portal customers hold NO policy on any wh_* table, so a
-- customer's select returns zero rows. That is deliberate and it is the same
-- reasoning as 20260914090200_internal_notes.sql: these rows name every
-- client's SKUs, lots and volumes side by side, and one brand reading another's
-- is the outcome CLAUDE.md calls the worst this system can produce. If the
-- portal ever shows a customer their own stock, that is a NEW policy scoped to
-- current_customer_client_id(), reviewed on its own -- not a widening of this.
--
-- Both layers name is_gl_staff(): a permissive staff policy AND the restrictive
-- "gl tenant guard", as every phase-1 table does.
--
-- WHY THE RULES LIVE HERE AND NOT IN THE PAGE
-- -------------------------------------------
-- The business rules that would cost money if skipped are enforced by triggers,
-- because anything the UI alone enforces is one REST call away from not being
-- enforced:
--   * a finished-good lot on QA HOLD cannot be put on, scheduled on, or
--     completed on a transfer to CONRI
--   * a transfer is draft -> scheduled -> completed (CONRI requires every
--     move be scheduled in advance), or cancelled; closed transfers are frozen
--   * completing a transfer moves its pallets, in the same statement
--   * wh_movements is written ONLY by trigger and can never be updated or
--     deleted, so the location history cannot be edited after the fact
--   * a pallet sits on at most one open transfer, and every pallet on a
--     transfer belongs to that transfer's client
--
-- ROLLBACK:
--   drop table if exists public.wh_outbound_orders, public.wh_movements,
--     public.wh_transfer_lines, public.wh_pallets, public.wh_transfers,
--     public.wh_lots, public.wh_skus cascade;
--   drop sequence if exists public.wh_pallet_tag_seq, public.wh_outbound_order_seq;
--   drop function if exists public.wh_assign_transfer_number(),
--     public.wh_guard_transfer(), public.wh_after_transfer(),
--     public.wh_guard_line_insert(), public.wh_after_line_insert(),
--     public.wh_guard_line_delete(), public.wh_after_line_delete(),
--     public.wh_log_pallet_movement(), public.wh_movements_append_only(),
--     public.wh_guard_outbound_order(), public.wh_guard_pallet(),
--     public.wh_check_lines_ready(uuid, text);
--   drop policy if exists "warehouse-docs staff all" on storage.objects;
--   delete from storage.objects where bucket_id = 'warehouse-docs';
--   delete from storage.buckets where id = 'warehouse-docs';
--   Reverting destroys every pallet record, transfer and movement, and the
--   signed packing lists. Export them first. Nothing outside wh_* reads them.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- SKU master (per client)
-- ────────────────────────────────────────────────────────────────
create table public.wh_skus (
  id                          uuid primary key default gen_random_uuid(),
  client_id                   uuid not null references public.clients(id) on delete restrict,
  upc_sku                     text not null check (length(btrim(upc_sku)) > 0),
  description                 text not null check (length(btrim(description)) > 0),
  brand                       text,
  pack                        text,
  units_per_case              integer check (units_per_case > 0),
  default_cases_per_pallet    integer check (default_cases_per_pallet > 0),
  default_pallet_weight_lbs   numeric(8,1) check (default_pallet_weight_lbs > 0),
  default_pallet_height_in    numeric(5,1) check (default_pallet_height_in > 0),
  inventory_type              text not null default 'finished_good'
                                check (inventory_type in ('finished_good','empty_can')),
  active                      boolean not null default true,
  notes                       text,
  -- Set when the SKU list is exported for CONRI's WMS. A SKU CONRI has never
  -- received cannot be scheduled in: they cannot receive what they cannot key.
  last_exported_at            timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- Stored as entered: the UPC may be short a digit or two, so length is a
  -- warning in the page, never a constraint here.
  unique (client_id, upc_sku)
);
create index wh_skus_client_idx on public.wh_skus (client_id);

-- ────────────────────────────────────────────────────────────────
-- Lots
-- ────────────────────────────────────────────────────────────────
create table public.wh_lots (
  id               uuid primary key default gen_random_uuid(),
  sku_id           uuid not null references public.wh_skus(id) on delete restrict,
  lot_number       text not null check (length(btrim(lot_number)) > 0),
  production_date  date,
  best_by_date     date,
  qa_status        text not null default 'hold' check (qa_status in ('hold','released')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (sku_id, lot_number),
  -- Target of the composite FK below, so a pallet's lot must be a lot OF
  -- that pallet's SKU.
  unique (id, sku_id)
);

-- ────────────────────────────────────────────────────────────────
-- Transfers (created before pallets: pallets reference the current one)
-- ────────────────────────────────────────────────────────────────
create table public.wh_transfers (
  id                  uuid primary key default gen_random_uuid(),
  transfer_number     text not null unique
                        check (transfer_number ~ '^GL-TR-[0-9]{8}-[0-9]{2,}$'),
  type                text not null check (type in
                        ('to_conri_finished','to_conri_overflow','pull_back','outbound_pickup')),
  transfer_date       date not null default current_date,
  scheduled_at        timestamptz,
  status              text not null default 'draft'
                        check (status in ('draft','scheduled','completed','cancelled')),
  client_id           uuid not null references public.clients(id) on delete restrict,
  carrier             text,
  ship_to             text,
  conri_confirmation  text,
  released_by         text,
  received_by         text,
  pallets_received    integer check (pallets_received >= 0),
  cases_received      integer check (cases_received >= 0),
  receipt_condition   text check (receipt_condition in ('good','exceptions')),
  exceptions          text,
  signed_doc_path     text,
  notes               text,
  created_by          uuid default auth.uid() references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index wh_transfers_client_idx on public.wh_transfers (client_id);
create index wh_transfers_open_idx on public.wh_transfers (scheduled_at)
  where status in ('draft','scheduled');

-- ────────────────────────────────────────────────────────────────
-- Pallets
-- ────────────────────────────────────────────────────────────────
create sequence public.wh_pallet_tag_seq;

create table public.wh_pallets (
  id                   uuid primary key default gen_random_uuid(),
  pallet_tag           text not null unique
                         default ('GL-P-' || lpad(nextval('public.wh_pallet_tag_seq')::text, 6, '0')),
  sku_id               uuid not null references public.wh_skus(id) on delete restrict,
  lot_id               uuid,
  cases                integer not null check (cases > 0),
  weight_lbs           numeric(8,1) check (weight_lbs > 0),
  height_in            numeric(5,1) check (height_in > 0),
  location             text not null default 'good_liquid'
                         check (location in ('good_liquid','conri','shipped')),
  status               text not null default 'staged'
                         check (status in ('staged','in_transit','stored','pulled','shipped','void')),
  current_transfer_id  uuid references public.wh_transfers(id) on delete restrict,
  received_at_conri    timestamptz,
  expected_pull_date   date,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint wh_pallets_lot_matches_sku
    foreign key (lot_id, sku_id) references public.wh_lots (id, sku_id) on delete restrict
);
create index wh_pallets_sku_idx on public.wh_pallets (sku_id);
create index wh_pallets_lot_idx on public.wh_pallets (lot_id);
create index wh_pallets_location_idx on public.wh_pallets (location, status);
create index wh_pallets_transfer_idx on public.wh_pallets (current_transfer_id)
  where current_transfer_id is not null;

create table public.wh_transfer_lines (
  transfer_id  uuid not null references public.wh_transfers(id) on delete restrict,
  pallet_id    uuid not null references public.wh_pallets(id) on delete restrict,
  line_no      integer not null check (line_no > 0),
  created_at   timestamptz not null default now(),
  primary key (transfer_id, pallet_id),
  unique (transfer_id, line_no)
);
create index wh_transfer_lines_pallet_idx on public.wh_transfer_lines (pallet_id);

-- ────────────────────────────────────────────────────────────────
-- Movement log — append-only, written only by trigger
-- ────────────────────────────────────────────────────────────────
create table public.wh_movements (
  seq            bigint generated always as identity primary key,
  pallet_id      uuid not null references public.wh_pallets(id) on delete restrict,
  transfer_id    uuid references public.wh_transfers(id) on delete restrict,
  from_location  text,
  to_location    text not null,
  from_status    text,
  to_status      text not null,
  actor          uuid default auth.uid(),
  at             timestamptz not null default now()
);
create index wh_movements_pallet_idx on public.wh_movements (pallet_id, seq);
create index wh_movements_transfer_idx on public.wh_movements (transfer_id) where transfer_id is not null;

-- ────────────────────────────────────────────────────────────────
-- Outbound orders (client release -> FEFO allocation -> carrier pickup)
-- ────────────────────────────────────────────────────────────────
create sequence public.wh_outbound_order_seq;

create table public.wh_outbound_orders (
  id                     uuid primary key default gen_random_uuid(),
  order_number           text not null unique
                           default ('GL-OB-' || lpad(nextval('public.wh_outbound_order_seq')::text, 5, '0')),
  client_id              uuid not null references public.clients(id) on delete restrict,
  release_reference      text,
  ship_to                text,
  requested_pickup_date  date,
  ship_method            text check (ship_method in ('LTL','FTL','parcel','customer_pickup')),
  carrier                text,
  status                 text not null default 'open'
                           check (status in ('open','allocated','shipped','cancelled')),
  bol_number             text,
  transfer_id            uuid unique references public.wh_transfers(id) on delete restrict,
  notes                  text,
  created_by             uuid default auth.uid() references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  shipped_at             timestamptz
);
create index wh_outbound_orders_client_idx on public.wh_outbound_orders (client_id);

-- ════════════════════════════════════════════════════════════════
-- Triggers
-- ════════════════════════════════════════════════════════════════

-- GL-TR-YYYYMMDD-NN, NN counting up per transfer_date. The advisory lock
-- serialises two staff creating a transfer for the same day; the unique
-- constraint is the backstop if anything ever bypasses this.
create or replace function public.wh_assign_transfer_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_day text;
  v_n   integer;
begin
  if tg_op = 'UPDATE' then
    if new.transfer_number is distinct from old.transfer_number then
      raise exception 'transfer_number is permanent (% -> %)', old.transfer_number, new.transfer_number;
    end if;
    return new;
  end if;
  if new.transfer_number is null or btrim(new.transfer_number) = '' then
    v_day := to_char(new.transfer_date, 'YYYYMMDD');
    perform pg_advisory_xact_lock(hashtext('wh_transfer_number'), v_day::integer);
    select coalesce(max(substring(transfer_number from '[0-9]+$')::integer), 0) + 1
      into v_n
      from public.wh_transfers
     where transfer_number like 'GL-TR-' || v_day || '-%';
    new.transfer_number := 'GL-TR-' || v_day || '-' || lpad(v_n::text, 2, '0');
  end if;
  return new;
end;
$fn$;

-- Every line on a transfer, checked against the rules for that transfer type.
-- Called when a transfer is scheduled and again when it is completed, because
-- a lot can be put back on QA hold between the two.
create or replace function public.wh_check_lines_ready(p_transfer uuid, p_type text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  r record;
begin
  for r in
    select p.pallet_tag, s.upc_sku, s.inventory_type, s.last_exported_at,
           l.lot_number, l.qa_status
      from public.wh_transfer_lines tl
      join public.wh_pallets p on p.id = tl.pallet_id
      join public.wh_skus s    on s.id = p.sku_id
      left join public.wh_lots l on l.id = p.lot_id
     where tl.transfer_id = p_transfer
  loop
    if p_type = 'to_conri_finished' then
      if r.lot_number is null then
        raise exception 'Pallet % has no lot. Finished goods need a QA-released lot.', r.pallet_tag;
      end if;
      if r.qa_status <> 'released' then
        raise exception 'Lot % (pallet %) is on QA hold. Release it before it goes to CONRI.', r.lot_number, r.pallet_tag;
      end if;
    end if;
    if p_type in ('to_conri_finished','to_conri_overflow') and r.last_exported_at is null then
      raise exception 'SKU % has never been exported to CONRI. Export the SKU list first.', r.upc_sku;
    end if;
  end loop;
end;
$fn$;

create or replace function public.wh_guard_transfer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_lines integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A transfer starts as a draft.';
    end if;
    return new;
  end if;

  -- Closed transfers are frozen, apart from paperwork: the signed packing list
  -- often arrives after the fact, and notes / CONRI's reference can be added.
  if old.status in ('completed','cancelled') then
    if new.status is distinct from old.status
       or new.type is distinct from old.type
       or new.client_id is distinct from old.client_id
       or new.transfer_date is distinct from old.transfer_date
       or new.pallets_received is distinct from old.pallets_received
       or new.cases_received is distinct from old.cases_received
       or new.received_by is distinct from old.received_by
       or new.receipt_condition is distinct from old.receipt_condition
       or new.exceptions is distinct from old.exceptions then
      raise exception 'Transfer % is %; only the signed document, notes and CONRI confirmation can change.',
        old.transfer_number, old.status;
    end if;
    return new;
  end if;

  select count(*) into v_lines from public.wh_transfer_lines where transfer_id = new.id;

  if (new.type is distinct from old.type or new.client_id is distinct from old.client_id) then
    if old.status <> 'draft' or v_lines > 0 then
      raise exception 'Type and client can only change on a draft with no pallets.';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'draft'     and new.status in ('scheduled','cancelled'))
      or (old.status = 'scheduled' and new.status in ('draft','completed','cancelled'))
    ) then
      raise exception 'A transfer cannot go from % to %. CONRI requires every move to be scheduled first.',
        old.status, new.status;
    end if;

    if new.status in ('scheduled','completed') then
      if v_lines = 0 then
        raise exception 'Transfer % has no pallets.', new.transfer_number;
      end if;
      if new.scheduled_at is null then
        raise exception 'Set the scheduled date and time before scheduling with CONRI.';
      end if;
      perform public.wh_check_lines_ready(new.id, new.type);
    end if;

    if new.status = 'completed' then
      if new.received_by is null or btrim(new.received_by) = '' then
        raise exception 'Record who received the pallets.';
      end if;
      if new.pallets_received is null or new.cases_received is null then
        raise exception 'Record the pallets and cases received.';
      end if;
      if new.receipt_condition is null then
        raise exception 'Record the condition: good, or exceptions noted.';
      end if;
      if new.receipt_condition = 'exceptions' and coalesce(btrim(new.exceptions), '') = '' then
        raise exception 'Describe the exceptions.';
      end if;
      new.completed_at := now();
    end if;
  end if;
  return new;
end;
$fn$;

-- Completing moves the pallets; cancelling releases them. Same statement, so a
-- transfer can never read "completed" while its pallets still read "staged".
create or replace function public.wh_after_transfer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.status = old.status then
    return null;
  end if;

  if new.status = 'completed' then
    update public.wh_pallets p
       set location = case new.type
                        when 'to_conri_finished' then 'conri'
                        when 'to_conri_overflow' then 'conri'
                        when 'pull_back'         then 'good_liquid'
                        when 'outbound_pickup'   then 'shipped'
                      end,
           status   = case new.type
                        when 'to_conri_finished' then 'stored'
                        when 'to_conri_overflow' then 'stored'
                        when 'pull_back'         then 'pulled'
                        when 'outbound_pickup'   then 'shipped'
                      end,
           received_at_conri = case when new.type in ('to_conri_finished','to_conri_overflow')
                                    then coalesce(new.scheduled_at, now()) else p.received_at_conri end,
           current_transfer_id = null
     where p.id in (select pallet_id from public.wh_transfer_lines where transfer_id = new.id);
  elsif new.status = 'cancelled' then
    update public.wh_pallets
       set current_transfer_id = null
     where current_transfer_id = new.id;
  end if;
  return null;
end;
$fn$;

create or replace function public.wh_guard_line_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  t record;
  p record;
begin
  select * into t from public.wh_transfers where id = new.transfer_id for update;
  if not found then
    raise exception 'Transfer not found.';
  end if;
  if t.status <> 'draft' then
    raise exception 'Pallets can only be added while transfer % is a draft.', t.transfer_number;
  end if;

  select pa.*, s.client_id as sku_client, s.inventory_type, l.qa_status, l.lot_number
    into p
    from public.wh_pallets pa
    join public.wh_skus s on s.id = pa.sku_id
    left join public.wh_lots l on l.id = pa.lot_id
   where pa.id = new.pallet_id
   for update of pa;
  if not found then
    raise exception 'Pallet not found.';
  end if;

  if p.current_transfer_id is not null and p.current_transfer_id <> t.id then
    raise exception 'Pallet % is already on another open transfer.', p.pallet_tag;
  end if;
  if p.sku_client <> t.client_id then
    raise exception 'Pallet % belongs to a different client than this transfer.', p.pallet_tag;
  end if;
  if p.status in ('shipped','void') then
    raise exception 'Pallet % is %.', p.pallet_tag, p.status;
  end if;

  if t.type in ('to_conri_finished','to_conri_overflow') and p.location <> 'good_liquid' then
    raise exception 'Pallet % is not at Good Liquid.', p.pallet_tag;
  end if;
  if t.type in ('pull_back','outbound_pickup') and p.location <> 'conri' then
    raise exception 'Pallet % is not at CONRI.', p.pallet_tag;
  end if;
  if t.type = 'to_conri_finished' then
    if p.inventory_type <> 'finished_good' then
      raise exception 'Pallet % is empty cans; use an overflow transfer.', p.pallet_tag;
    end if;
    if p.lot_number is null then
      raise exception 'Pallet % has no lot. Finished goods need a QA-released lot.', p.pallet_tag;
    end if;
    if p.qa_status <> 'released' then
      raise exception 'Lot % is on QA hold. Release it before it goes to CONRI.', p.lot_number;
    end if;
  end if;
  if t.type = 'to_conri_overflow' and p.inventory_type <> 'empty_can' then
    raise exception 'Pallet % is a finished good; use a finished-goods transfer.', p.pallet_tag;
  end if;

  if new.line_no is null then
    select coalesce(max(line_no), 0) + 1 into new.line_no
      from public.wh_transfer_lines where transfer_id = new.transfer_id;
  end if;
  return new;
end;
$fn$;

create or replace function public.wh_after_line_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  update public.wh_pallets set current_transfer_id = new.transfer_id where id = new.pallet_id;
  return null;
end;
$fn$;

create or replace function public.wh_guard_line_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  select status into v_status from public.wh_transfers where id = old.transfer_id;
  if v_status is distinct from 'draft' then
    raise exception 'Pallets can only be removed while the transfer is a draft.';
  end if;
  return old;
end;
$fn$;

create or replace function public.wh_after_line_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  update public.wh_pallets set current_transfer_id = null
   where id = old.pallet_id and current_transfer_id = old.transfer_id;
  return null;
end;
$fn$;

-- The only writer of wh_movements. SECURITY DEFINER because authenticated
-- holds no INSERT on the log: a movement can only come from a real change to a
-- pallet, never from a hand-written row.
create or replace function public.wh_log_pallet_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.wh_movements (pallet_id, transfer_id, from_location, to_location, from_status, to_status)
    values (new.id, new.current_transfer_id, null, new.location, null, new.status);
  elsif new.location is distinct from old.location or new.status is distinct from old.status then
    insert into public.wh_movements (pallet_id, transfer_id, from_location, to_location, from_status, to_status)
    values (new.id, coalesce(new.current_transfer_id, old.current_transfer_id),
            old.location, new.location, old.status, new.status);
  end if;
  return null;
end;
$fn$;

create or replace function public.wh_movements_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  raise exception 'wh_movements is append-only';
end;
$fn$;

create or replace function public.wh_guard_outbound_order()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_type   text;
  v_client uuid;
  v_status text;
begin
  if tg_op = 'UPDATE' and old.status in ('shipped','cancelled') and new.status is distinct from old.status then
    raise exception 'Order % is already %.', old.order_number, old.status;
  end if;
  if new.transfer_id is not null then
    select type, client_id, status into v_type, v_client, v_status
      from public.wh_transfers where id = new.transfer_id;
    if v_type <> 'outbound_pickup' then
      raise exception 'An outbound order links only to an outbound pickup transfer.';
    end if;
    if v_client <> new.client_id then
      raise exception 'The linked transfer belongs to a different client.';
    end if;
  end if;
  if new.status = 'shipped' then
    if coalesce(btrim(new.bol_number), '') = '' then
      raise exception 'Enter the BOL number before marking the order shipped.';
    end if;
    if v_status is distinct from 'completed' then
      raise exception 'Complete the pickup transfer before marking the order shipped.';
    end if;
    if tg_op = 'INSERT' or old.status <> 'shipped' then
      new.shipped_at := now();
    end if;
  end if;
  return new;
end;
$fn$;

-- Voiding is for a pallet record made in error (a quick build with the wrong
-- count). Only a pallet still at Good Liquid and on no transfer can be voided,
-- and a void is final, so it can never be used to make stock at CONRI vanish.
create or replace function public.wh_guard_pallet()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.status = 'void' and new.status is distinct from 'void' then
    raise exception 'Pallet % is void.', old.pallet_tag;
  end if;
  if new.status = 'void' and old.status <> 'void' then
    if old.location <> 'good_liquid' or old.current_transfer_id is not null then
      raise exception 'Only a pallet at Good Liquid and on no transfer can be voided.';
    end if;
  end if;
  if new.pallet_tag is distinct from old.pallet_tag then
    raise exception 'pallet_tag is permanent.';
  end if;
  return new;
end;
$fn$;

create trigger wh_transfers_number before insert or update on public.wh_transfers
  for each row execute function public.wh_assign_transfer_number();
create trigger wh_transfers_guard before insert or update on public.wh_transfers
  for each row execute function public.wh_guard_transfer();
create trigger wh_transfers_after after update of status on public.wh_transfers
  for each row execute function public.wh_after_transfer();

create trigger wh_lines_guard_insert before insert on public.wh_transfer_lines
  for each row execute function public.wh_guard_line_insert();
create trigger wh_lines_after_insert after insert on public.wh_transfer_lines
  for each row execute function public.wh_after_line_insert();
create trigger wh_lines_guard_delete before delete on public.wh_transfer_lines
  for each row execute function public.wh_guard_line_delete();
create trigger wh_lines_after_delete after delete on public.wh_transfer_lines
  for each row execute function public.wh_after_line_delete();

create trigger wh_pallets_guard before update on public.wh_pallets
  for each row execute function public.wh_guard_pallet();
create trigger wh_pallets_movement after insert or update on public.wh_pallets
  for each row execute function public.wh_log_pallet_movement();

create trigger wh_movements_append_only before update or delete on public.wh_movements
  for each row execute function public.wh_movements_append_only();
create trigger wh_movements_no_truncate before truncate on public.wh_movements
  for each statement execute function public.wh_movements_append_only();

create trigger wh_outbound_orders_guard before insert or update on public.wh_outbound_orders
  for each row execute function public.wh_guard_outbound_order();

create trigger set_updated_at before update on public.wh_skus
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.wh_lots
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.wh_transfers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.wh_pallets
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.wh_outbound_orders
  for each row execute function public.set_updated_at();

-- Trigger functions are not an API. Same as 20260914090500.
revoke all on function public.wh_assign_transfer_number() from public, anon, authenticated;
revoke all on function public.wh_check_lines_ready(uuid, text) from public, anon;
-- Called from wh_guard_transfer(), which runs as the caller, so staff need
-- EXECUTE. It is SECURITY INVOKER: it reads only rows the caller can already
-- see, and all it can do is raise.
grant execute on function public.wh_check_lines_ready(uuid, text) to authenticated;
revoke all on function public.wh_guard_transfer()         from public, anon, authenticated;
revoke all on function public.wh_after_transfer()         from public, anon, authenticated;
revoke all on function public.wh_guard_line_insert()      from public, anon, authenticated;
revoke all on function public.wh_after_line_insert()      from public, anon, authenticated;
revoke all on function public.wh_guard_line_delete()      from public, anon, authenticated;
revoke all on function public.wh_after_line_delete()      from public, anon, authenticated;
revoke all on function public.wh_log_pallet_movement()    from public, anon, authenticated;
revoke all on function public.wh_movements_append_only()  from public, anon, authenticated;
revoke all on function public.wh_guard_outbound_order()   from public, anon, authenticated;
revoke all on function public.wh_guard_pallet()           from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- Grants + RLS: staff only, two layers
-- ════════════════════════════════════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array['wh_skus','wh_lots','wh_transfers','wh_pallets',
                           'wh_transfer_lines','wh_movements','wh_outbound_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    -- authenticated too: Supabase's default privileges grant ALL on every new
    -- table to authenticated, so revoking only anon leaves the narrow grants
    -- below narrowing nothing. The dry run caught exactly that: staff could
    -- hand-insert a movement row until this line included authenticated.
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.is_gl_staff()) with check (public.is_gl_staff())',
      t || ' staff all', t);
    execute format(
      'create policy "gl tenant guard" on public.%I as restrictive to authenticated '
      || 'using (public.is_gl_staff()) with check (public.is_gl_staff())', t);
  end loop;
end $$;

-- No DELETE anywhere except draft lines: a SKU, lot or pallet that has ever
-- existed stays for traceability (deactivate a SKU; void a pallet); a transfer
-- is cancelled, never deleted.
grant select, insert, update on public.wh_skus, public.wh_lots, public.wh_pallets,
  public.wh_transfers, public.wh_outbound_orders to authenticated;
grant select, insert, delete on public.wh_transfer_lines to authenticated;
grant select on public.wh_movements to authenticated;
revoke all on sequence public.wh_pallet_tag_seq, public.wh_outbound_order_seq from anon, authenticated, public;
grant usage on sequence public.wh_pallet_tag_seq, public.wh_outbound_order_seq to authenticated;

-- ════════════════════════════════════════════════════════════════
-- Signed packing lists: private bucket, staff only
-- ════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('warehouse-docs', 'warehouse-docs', false, 26214400,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "warehouse-docs staff all" on storage.objects
  for all to authenticated
  using      (bucket_id = 'warehouse-docs' and public.is_gl_staff())
  with check (bucket_id = 'warehouse-docs' and public.is_gl_staff());

notify pgrst, 'reload schema';
