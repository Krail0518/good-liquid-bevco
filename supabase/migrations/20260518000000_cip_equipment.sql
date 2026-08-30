-- ============================================================
-- CIP equipment list — synced across users/devices
-- ============================================================
-- Replaces the per-device localStorage CIP equipment list with a
-- proper table. Used by the Equipment / circuit dropdown on the
-- 9-step CIP log form (GMP-SAN-002).
--
-- Seeded with the original 8 defaults so existing setups keep working
-- without manual data entry.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.cip_equipment (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order integer not null default 100,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cip_equipment_active on public.cip_equipment(active, sort_order);

alter table public.cip_equipment enable row level security;
drop policy if exists "cip_equipment authed" on public.cip_equipment;
create policy "cip_equipment authed" on public.cip_equipment
  for all to authenticated using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    drop trigger if exists trg_cip_equipment_updated on public.cip_equipment;
    create trigger trg_cip_equipment_updated before update on public.cip_equipment
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Seed the original defaults only when the table is empty.
insert into public.cip_equipment (name, sort_order)
select name, sort_order from (values
  ('Filling Line 1',      10),
  ('Filling Line 2',      20),
  ('Pasteurizer plates',  30),
  ('Mix tank',            40),
  ('Fermenter 1',         50),
  ('Fermenter 2',         60),
  ('Carbonator',          70),
  ('CIP skid',            80)
) as v(name, sort_order)
where not exists (select 1 from public.cip_equipment limit 1);

notify pgrst, 'reload schema';
