-- ============================================================
-- Clients: support multiple email addresses per account
-- ============================================================
-- Adds an `additional_emails` JSONB column that stores an array of
-- { label, email } pairs. The primary `email` column stays as the
-- main contact. Additional emails are for AP, ops, sales contacts,
-- compliance contacts, etc.
--
-- Shape:
--   [
--     { "label": "AP",  "email": "ap@client.com" },
--     { "label": "Ops", "email": "ops@client.com" }
--   ]
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.clients
  add column if not exists additional_emails jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
