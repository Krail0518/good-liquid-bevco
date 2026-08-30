-- ============================================================
-- Clients table — add columns the Edit Client modal writes
-- ============================================================
-- Before this migration, saving the Edit Client form would silently
-- fail at the database (the UI would show success because the in-memory
-- copy was updated, but the Supabase write was rejected with
-- PGRST204 "Could not find the 'contact_type' column of 'clients' in
-- the schema cache"). On page refresh, the row reloaded its old values.
--
-- This adds every column referenced in fix.js → glUpdateClient's
-- supaPatch that wasn't already in the table.
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.clients add column if not exists contact_type           text;
alter table public.clients add column if not exists shipping_same          boolean not null default true;
alter table public.clients add column if not exists shipping_street        text;
alter table public.clients add column if not exists shipping_city          text;
alter table public.clients add column if not exists shipping_state         text;
alter table public.clients add column if not exists shipping_zip           text;
alter table public.clients add column if not exists lift_gate              boolean not null default false;
alter table public.clients add column if not exists dock_days              text[];
alter table public.clients add column if not exists dock_hours             text;
alter table public.clients add column if not exists payment_method         text;
alter table public.clients add column if not exists lead_source            text;
alter table public.clients add column if not exists w9_file_path           text;
alter table public.clients add column if not exists tax_exempt             boolean not null default false;
alter table public.clients add column if not exists tax_exempt_state       text;
alter table public.clients add column if not exists tax_exempt_file_path   text;

-- Notify PostgREST so the schema cache picks up the new columns
-- (otherwise the API keeps rejecting them until the next reload).
notify pgrst, 'reload schema';
