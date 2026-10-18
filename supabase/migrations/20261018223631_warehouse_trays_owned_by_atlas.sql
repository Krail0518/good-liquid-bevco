-- ════════════════════════════════════════════════════════════════
-- Data fix: the Pak-it carrier trays at CONRI belong to Atlas Canning
-- ════════════════════════════════════════════════════════════════
-- They were entered as Good Liquid's own packaging (client_id NULL) because
-- packaging could not belong to a client until 20261018223546. The owner
-- says they are Atlas Canning's. This moves the four tray SKUs, and so all
-- their pallets, to Atlas, and relabels the two transfers they moved on:
--   GL-TR-20261008-01  in to CONRI (Pak-it delivery)
--   GL-TR-20261010-01  pull back of CONRI #9606 and #9607
-- Both are completed, and wh_guard_transfer rightly refuses to change a
-- completed transfer's client, so that trigger is switched off for these two
-- rows only and switched straight back on, inside this one transaction.
--
-- Matched by item number and transfer number, not generated ids, and each
-- step checks it touched exactly what it should.
--
-- ROLLBACK:
--   alter table public.wh_transfers disable trigger wh_transfers_guard;
--   update public.wh_transfers set client_id = null
--    where transfer_number in ('GL-TR-20261008-01','GL-TR-20261010-01');
--   alter table public.wh_transfers enable trigger wh_transfers_guard;
--   update public.wh_skus set client_id = null
--    where upc_sku in ('TRAY12SLIM-1800','TRAY12-1800','TRAY24-SLK-1200','TRAY24-600')
--      and client_id = (select id from public.clients where name ilike 'Atlas canning');

do $fix$
declare
  v_atlas uuid;
  n integer;
begin
  select id into v_atlas from public.clients where name ilike 'Atlas canning';
  if v_atlas is null then raise exception 'Atlas Canning client not found.'; end if;

  update public.wh_skus set client_id = v_atlas
   where client_id is null and inventory_type = 'packaging'
     and upc_sku in ('TRAY12SLIM-1800','TRAY12-1800','TRAY24-SLK-1200','TRAY24-600');
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'Expected 4 tray SKUs, moved %.', n; end if;

  alter table public.wh_transfers disable trigger wh_transfers_guard;
  update public.wh_transfers set client_id = v_atlas
   where client_id is null and transfer_number in ('GL-TR-20261008-01','GL-TR-20261010-01');
  get diagnostics n = row_count;
  alter table public.wh_transfers enable trigger wh_transfers_guard;
  if n <> 2 then raise exception 'Expected 2 transfers, relabelled %.', n; end if;
end $fix$;
