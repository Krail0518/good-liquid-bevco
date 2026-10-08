-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage — Good Liquid's own packaging supplies
-- ════════════════════════════════════════════════════════════════
-- Until now every SKU and every transfer belonged to a client, and the only
-- inventory types were a client's finished goods and empty cans. Good Liquid
-- also stores its OWN supplies at CONRI (carrier trays, lids, cartons from
-- vendors like Pak-it), and the database refused them: a SKU needed a client.
--
-- This adds a third inventory type, 'packaging', owned by Good Liquid itself.
-- Ownership is expressed as client_id IS NULL, and the constraints below make
-- that exact in both directions:
--   * a packaging SKU has no client, and a SKU with no client is packaging
--   * a transfer with no client is Good Liquid's own: to_conri_packaging, or a
--     pull_back of Good Liquid stock. Every other type still needs a client.
-- One item per pallet, as before (the usual case for packaging deliveries).
--
-- WHY THE LINE GUARD CHANGES
-- --------------------------
-- wh_guard_line_insert compared `p.sku_client <> t.client_id`. With NULL on
-- either side that comparison is NULL, the IF is skipped, and the pallet would
-- be accepted onto ANY client's transfer. It is now IS DISTINCT FROM, so a
-- Good Liquid pallet cannot ride a client's transfer and a client's pallet
-- cannot ride a Good Liquid one. Nothing else in the trigger set compares a
-- nullable client: wh_guard_transfer already uses IS DISTINCT FROM, and an
-- outbound pickup always has a client (constraint below).
--
-- WHO CAN SEE IT
-- --------------
-- Unchanged: staff only, both layers (see 20260930120000). No policy is added
-- or widened. A portal customer still holds no policy on any wh_* table, and
-- Good Liquid's own stock has no client_id that current_customer_client_id()
-- could ever match.
--
-- ROLLBACK:
--   Only safe while no packaging rows exist; check first:
--     select count(*) from public.wh_skus where inventory_type = 'packaging';
--     select count(*) from public.wh_transfers where client_id is null;
--   Then:
--     drop index if exists public.wh_skus_gl_upc_key;
--     alter table public.wh_skus drop constraint wh_skus_packaging_owner_check;
--     alter table public.wh_skus drop constraint wh_skus_inventory_type_check;
--     alter table public.wh_skus add constraint wh_skus_inventory_type_check
--       check (inventory_type in ('finished_good','empty_can'));
--     alter table public.wh_skus alter column client_id set not null;
--     alter table public.wh_transfers drop constraint wh_transfers_owner_check;
--     alter table public.wh_transfers drop constraint wh_transfers_type_check;
--     alter table public.wh_transfers add constraint wh_transfers_type_check
--       check (type in ('to_conri_finished','to_conri_overflow','pull_back','outbound_pickup'));
--     alter table public.wh_transfers alter column client_id set not null;
--   and re-run the three function bodies from 20260930120000_warehouse_storage.sql
--   (wh_check_lines_ready, wh_after_transfer, wh_guard_line_insert).

set search_path = public, extensions;

-- ── SKUs ─────────────────────────────────────────────────────────
alter table public.wh_skus alter column client_id drop not null;
alter table public.wh_skus drop constraint wh_skus_inventory_type_check;
alter table public.wh_skus add constraint wh_skus_inventory_type_check
  check (inventory_type in ('finished_good','empty_can','packaging'));
alter table public.wh_skus add constraint wh_skus_packaging_owner_check
  check ((inventory_type = 'packaging') = (client_id is null));
-- unique (client_id, upc_sku) treats NULLs as distinct, so it does not stop
-- two Good Liquid SKUs with the same item number. This does.
create unique index wh_skus_gl_upc_key on public.wh_skus (upc_sku) where client_id is null;

-- ── Transfers ────────────────────────────────────────────────────
alter table public.wh_transfers alter column client_id drop not null;
alter table public.wh_transfers drop constraint wh_transfers_type_check;
alter table public.wh_transfers add constraint wh_transfers_type_check
  check (type in ('to_conri_finished','to_conri_overflow','to_conri_packaging','pull_back','outbound_pickup'));
alter table public.wh_transfers add constraint wh_transfers_owner_check
  check (case type
           when 'to_conri_packaging' then client_id is null
           when 'pull_back'          then true
           else client_id is not null
         end);

-- ── Triggers ─────────────────────────────────────────────────────
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
    if p_type in ('to_conri_finished','to_conri_overflow','to_conri_packaging') and r.last_exported_at is null then
      raise exception 'SKU % has never been exported to CONRI. Export the SKU list first.', r.upc_sku;
    end if;
  end loop;
end;
$fn$;

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
                        when 'to_conri_finished'  then 'conri'
                        when 'to_conri_overflow'  then 'conri'
                        when 'to_conri_packaging' then 'conri'
                        when 'pull_back'          then 'good_liquid'
                        when 'outbound_pickup'    then 'shipped'
                      end,
           status   = case new.type
                        when 'to_conri_finished'  then 'stored'
                        when 'to_conri_overflow'  then 'stored'
                        when 'to_conri_packaging' then 'stored'
                        when 'pull_back'          then 'pulled'
                        when 'outbound_pickup'    then 'shipped'
                      end,
           received_at_conri = case when new.type in ('to_conri_finished','to_conri_overflow','to_conri_packaging')
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
  -- IS DISTINCT FROM, not <>: client_id is NULL for Good Liquid's own stock,
  -- and <> against NULL would let any pallet onto any transfer.
  if p.sku_client is distinct from t.client_id then
    raise exception 'Pallet % belongs to a different owner than this transfer.', p.pallet_tag;
  end if;
  if p.status in ('shipped','void') then
    raise exception 'Pallet % is %.', p.pallet_tag, p.status;
  end if;

  if t.type in ('to_conri_finished','to_conri_overflow','to_conri_packaging') and p.location <> 'good_liquid' then
    raise exception 'Pallet % is not at Good Liquid.', p.pallet_tag;
  end if;
  if t.type in ('pull_back','outbound_pickup') and p.location <> 'conri' then
    raise exception 'Pallet % is not at CONRI.', p.pallet_tag;
  end if;
  if t.type = 'to_conri_finished' then
    if p.inventory_type <> 'finished_good' then
      raise exception 'Pallet % is not a finished good; use an overflow or packaging transfer.', p.pallet_tag;
    end if;
    if p.lot_number is null then
      raise exception 'Pallet % has no lot. Finished goods need a QA-released lot.', p.pallet_tag;
    end if;
    if p.qa_status <> 'released' then
      raise exception 'Lot % is on QA hold. Release it before it goes to CONRI.', p.lot_number;
    end if;
  end if;
  if t.type = 'to_conri_overflow' and p.inventory_type <> 'empty_can' then
    raise exception 'Pallet % is not empty cans; use a finished-goods or packaging transfer.', p.pallet_tag;
  end if;
  if t.type = 'to_conri_packaging' and p.inventory_type <> 'packaging' then
    raise exception 'Pallet % is not Good Liquid packaging.', p.pallet_tag;
  end if;

  if new.line_no is null then
    select coalesce(max(line_no), 0) + 1 into new.line_no
      from public.wh_transfer_lines where transfer_id = new.transfer_id;
  end if;
  return new;
end;
$fn$;

-- CREATE OR REPLACE keeps existing grants; restated so this file reads alone.
revoke all on function public.wh_after_transfer()    from public, anon, authenticated;
revoke all on function public.wh_guard_line_insert() from public, anon, authenticated;
revoke all on function public.wh_check_lines_ready(uuid, text) from public, anon;
grant execute on function public.wh_check_lines_ready(uuid, text) to authenticated;

notify pgrst, 'reload schema';
