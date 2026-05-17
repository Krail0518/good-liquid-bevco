-- ============================================================
-- Blanket RLS — authenticated CRUD on every CRM table
-- ============================================================
-- Symptom class: "I deleted/updated X, refreshed, the change came back."
-- Cause: a table has RLS enabled but is missing a DELETE (or UPDATE)
-- policy for authenticated users. Postgres silently denies the
-- operation — 0 rows affected, no error — and PostgREST returns 204.
-- The JS sees no error, mutates the in-memory copy, refresh re-reads
-- from the database, and the old row reappears.
--
-- This migration ensures every standard CRM table in public schema has
-- a permissive "authed all" policy that lets authenticated users read,
-- insert, update, and delete. The CRM is single-tenant (Good Liquid
-- staff only); per-row ownership is not the threat model here. Auth
-- still keeps unauthenticated visitors out via the `to authenticated`
-- role filter.
--
-- The DO block iterates pg_tables so new tables added later are
-- automatically covered when this migration is re-run.
--
-- A small denylist holds sensitive tables we DON'T blanket:
--   - qbo_tokens   : OAuth refresh tokens, service-role only
--   - profiles     : has its own self-only + admin policies upstream
--   - audit_log    : append-only, gets SELECT + INSERT only (no DELETE/UPDATE)
--
-- Tables that already had targeted policies (e.g. inspector_tokens'
-- anon-by-token read, client_allergen_declarations' share_token read)
-- keep those — Postgres OR's policies — so the new "authed all" rule
-- is additive, not destructive.
--
-- Idempotent. Safe to re-run after adding new tables.
-- ============================================================

do $$
declare
  t text;
  denylist text[] := array['qbo_tokens', 'profiles', 'audit_log'];
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not like 'pg_%'
      and not (tablename = any(denylist))
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %L on public.%I', t || ' authed all', t);
    execute format('create policy %L on public.%I for all to authenticated using (true) with check (true)', t || ' authed all', t);
  end loop;
end $$;

-- audit_log: append-only — grant SELECT + INSERT, withhold UPDATE/DELETE.
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='audit_log') then
    execute 'alter table public.audit_log enable row level security';
    execute 'drop policy if exists "audit_log authed select" on public.audit_log';
    execute 'create policy "audit_log authed select" on public.audit_log for select to authenticated using (true)';
    execute 'drop policy if exists "audit_log authed insert" on public.audit_log';
    execute 'create policy "audit_log authed insert" on public.audit_log for insert to authenticated with check (true)';
  end if;
end $$;

-- Force PostgREST to drop its schema cache so the new policies take effect immediately.
notify pgrst, 'reload schema';
