-- ============================================================
-- Per-client pricing overrides
-- ============================================================
-- The canning_rates / bottling_rates tables hold the public price
-- ladders (everyone gets the same tier ladder). This table lets
-- staff set a NEGOTIATED flat rate for a specific client — used
-- when:
--   • Mike pre-quoted a custom rate during sales
--   • A bulk customer gets a discount below the lowest published tier
--   • A pilot/incubator client gets sub-cost rates for a launch
--
-- One row per (client_id, service, format). When the invoice builder
-- picks a rate, it checks here first; only falls back to the global
-- tier table if no override row exists.
--
-- Services:
--   canning  — override is price_per_can
--   bottling — override is price_per_unit
--   rd       — override is hourly rate for R&D / formulation
--   production — override is hourly rate for production-floor labor
--   consulting — override is hourly rate for advisory engagements
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.client_rate_overrides (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  service         text not null check (service in ('canning','bottling','rd','production','consulting')),
  format          text,
  override_rate   numeric(10,4) not null check (override_rate >= 0),
  notes           text,
  effective_from  date,
  effective_until date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A client can have at most ONE override per (service, format).
  -- Format is nullable for hour-based services where it doesn't apply.
  -- Postgres treats nulls as distinct in unique constraints, so we
  -- coalesce to an empty string via a generated column instead.
  format_key      text generated always as (coalesce(format, '')) stored,
  unique (client_id, service, format_key)
);
create index if not exists idx_client_rate_overrides_client on public.client_rate_overrides(client_id);

drop trigger if exists trg_client_rate_overrides_updated on public.client_rate_overrides;
create trigger trg_client_rate_overrides_updated before update on public.client_rate_overrides
  for each row execute function public.set_updated_at();

alter table public.client_rate_overrides enable row level security;

-- Staff-only — customers never see this table.
drop policy if exists "client_rate_overrides staff all" on public.client_rate_overrides;
create policy "client_rate_overrides staff all" on public.client_rate_overrides
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

notify pgrst, 'reload schema';
