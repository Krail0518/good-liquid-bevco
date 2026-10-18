-- ════════════════════════════════════════════════════════════════
-- Warehouse Storage — packaging can belong to a client
-- ════════════════════════════════════════════════════════════════
-- 20261008140620 made packaging and Good Liquid ownership the same thing:
-- a packaging SKU had no client, and a packaging transfer had no client.
-- That assumption was wrong. The Pak-it carrier trays at CONRI belong to
-- Atlas Canning, a client, and the page could only label them "Good
-- Liquid (own packaging)". Clients store packaging with us too, and they
-- are billed for it like any other pallet.
--
-- Now:
--   * a packaging SKU may belong to any client, or to Good Liquid (NULL)
--   * a SKU with no client is still always packaging (Good Liquid only
--     stores its own supplies, never its own finished goods)
--   * a packaging transfer may be a client's or Good Liquid's
--   * a SKU's owner can be changed, which moves its pallets with it, but
--     not while any of them is on an open transfer: the transfer's client
--     must keep matching its pallets (wh_guard_line_insert)
--
-- WHO CAN SEE IT
--   Unchanged: staff only, both layers (20260930120000). No policy is
--   added or widened; a portal customer still holds no wh_* policy.
--
-- ROLLBACK:
--   Only while no client owns packaging; check first:
--     select count(*) from public.wh_skus where inventory_type = 'packaging' and client_id is not null;
--     select count(*) from public.wh_transfers where type = 'to_conri_packaging' and client_id is not null;
--   Then:
--     drop trigger if exists wh_skus_owner_guard on public.wh_skus;
--     drop function if exists public.wh_guard_sku_owner();
--     alter table public.wh_skus drop constraint wh_skus_gl_owner_packaging_check;
--     alter table public.wh_skus add constraint wh_skus_packaging_owner_check
--       check ((inventory_type = 'packaging') = (client_id is null));
--     alter table public.wh_transfers drop constraint wh_transfers_owner_check;
--     alter table public.wh_transfers add constraint wh_transfers_owner_check
--       check (case type when 'to_conri_packaging' then client_id is null
--                        when 'pull_back' then true else client_id is not null end);

set search_path = public, extensions;

alter table public.wh_skus drop constraint wh_skus_packaging_owner_check;
alter table public.wh_skus add constraint wh_skus_gl_owner_packaging_check
  check (client_id is not null or inventory_type = 'packaging');

alter table public.wh_transfers drop constraint wh_transfers_owner_check;
alter table public.wh_transfers add constraint wh_transfers_owner_check
  check (case type
           when 'to_conri_packaging' then true
           when 'pull_back'          then true
           else client_id is not null
         end);

create or replace function public.wh_guard_sku_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_tag text;
begin
  if new.client_id is distinct from old.client_id then
    select p.pallet_tag into v_tag
      from public.wh_pallets p
     where p.sku_id = new.id and p.current_transfer_id is not null
     limit 1;
    if found then
      raise exception 'Pallet % of SKU % is on an open transfer. Finish or cancel it before changing the owner.', v_tag, old.upc_sku;
    end if;
  end if;
  return new;
end;
$fn$;
revoke all on function public.wh_guard_sku_owner() from public, anon, authenticated;
create trigger wh_skus_owner_guard before update of client_id on public.wh_skus
  for each row execute function public.wh_guard_sku_owner();

notify pgrst, 'reload schema';
