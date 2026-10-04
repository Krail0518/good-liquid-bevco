-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage — first real record: Camo Energy to CONRI, 09/30/2026
-- ════════════════════════════════════════════════════════════════
-- The owner asked for this transfer to be the first record, and for the
-- generated packing list and labels to be checked against it:
--
--   Camo Energy Glow, UPC/SKU 6001390576 (stored as entered; it may be short a
--   digit, which the page warns about rather than rejects), 12 count tray,
--   12 units per case. Lot 628290B, produced 09/28/2026, best by 03/28/2028,
--   QA released. 7 pallets x 200 cases = 1,400 cases = 16,800 units, about
--   2,000 lbs per pallet. Transfer GL-TR-20260930-01, finished goods to CONRI.
--
-- Camo Energy was not in `clients`, so a minimal client row is created; the
-- rest of its profile is filled in from the Clients page like any other.
--
-- The transfer is left a DRAFT on purpose. The SKU has not been exported to
-- CONRI yet and no pickup time is set, and the schedule trigger refuses both.
-- Staff export the SKU list, set the time, and schedule it from the page --
-- the same path every later transfer takes.
--
-- Idempotent: does nothing if the transfer already exists.
--
-- ROLLBACK:
--   This is business data, not schema. While the transfer is still a draft:
--     delete from public.wh_transfer_lines where transfer_id =
--       (select id from public.wh_transfers where transfer_number = 'GL-TR-20260930-01');
--   Pallets, movements and the transfer are deliberately undeletable by staff
--   (append-only history); remove them as the table owner only if the seed
--   itself was wrong, in the order movements, lines, pallets, transfer, lot,
--   SKU, then the Camo Energy client if nothing else references it.

set search_path = public, extensions;

do $$
declare
  v_client uuid;
  v_sku    uuid;
  v_lot    uuid;
  v_tr     uuid;
  v_num    text;
  v_pallet uuid;
  i        integer;
begin
  if exists (select 1 from public.wh_transfers where transfer_number = 'GL-TR-20260930-01') then
    raise notice 'GL-TR-20260930-01 already exists; seed skipped';
    return;
  end if;

  select id into v_client from public.clients where lower(btrim(name)) = 'camo energy' limit 1;
  if v_client is null then
    insert into public.clients (name, company, status, initials)
    values ('Camo Energy', 'Camo Energy', 'active', 'CE')
    returning id into v_client;
  end if;

  insert into public.wh_skus (client_id, upc_sku, description, brand, pack, units_per_case,
                              default_cases_per_pallet, default_pallet_weight_lbs, inventory_type)
  values (v_client, '6001390576', 'Camo Energy Glow', 'Camo Energy', '12 count tray', 12,
          200, 2000, 'finished_good')
  on conflict (client_id, upc_sku) do update set description = excluded.description
  returning id into v_sku;

  insert into public.wh_lots (sku_id, lot_number, production_date, best_by_date, qa_status)
  values (v_sku, '628290B', date '2026-09-28', date '2028-03-28', 'released')
  on conflict (sku_id, lot_number) do update set qa_status = 'released'
  returning id into v_lot;

  insert into public.wh_transfers (type, client_id, transfer_date, released_by, notes)
  values ('to_conri_finished', v_client, date '2026-09-30', 'Mike Krail',
          'First warehouse record. Seeded from the module spec.')
  returning id, transfer_number into v_tr, v_num;

  if v_num <> 'GL-TR-20260930-01' then
    raise exception 'expected GL-TR-20260930-01, trigger assigned %', v_num;
  end if;

  for i in 1..7 loop
    insert into public.wh_pallets (sku_id, lot_id, cases, weight_lbs)
    values (v_sku, v_lot, 200, 2000)
    returning id into v_pallet;
    insert into public.wh_transfer_lines (transfer_id, pallet_id, line_no)
    values (v_tr, v_pallet, i);
  end loop;
end $$;
