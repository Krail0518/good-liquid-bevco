-- ============================================================
-- Add quote-form fields to deals table
-- ============================================================
-- The quote form collects 13 fields but the deals table only
-- stored name, client_name, value, stage, probability, notes.
-- This migration adds structured columns for every quote field
-- so they're searchable / filterable and visible in the detail
-- panel without parsing the notes text blob.
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.deals
  add column if not exists contact_name   text,
  add column if not exists email          text,
  add column if not exists phone          text,
  add column if not exists city           text,
  add column if not exists state          text,
  add column if not exists service        text,
  add column if not exists product_type   text,
  add column if not exists volume         text,
  add column if not exists timeline       text,
  add column if not exists funding_stage  text,
  add column if not exists lead_source    text;

-- Back-fill: try to parse the plain-text note block written by
-- submitContactForm for any rows that have notes but no email.
-- This is best-effort; if the note doesn't follow the pattern,
-- it's a no-op for that row.
update public.deals
set
  contact_name = (regexp_match(notes, 'Contact:\s*([^\(]+)'))[1],
  email        = (regexp_match(notes, '[\w.+-]+@[\w.-]+\.\w+'))[1]
where email is null and notes is not null and notes <> '';

notify pgrst, 'reload schema';
