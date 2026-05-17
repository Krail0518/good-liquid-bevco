-- ============================================================
-- Invoices: add payment_terms column
-- ============================================================
-- glSaveInvoice ships a `payment_terms` field on the update/insert
-- payload (e.g. "Due on receipt", "Net 30"). The column was missing
-- from public.invoices, which caused PostgREST to abort every UPDATE
-- with PGRST204 "Could not find the 'payment_terms' column of
-- 'invoices' in the schema cache" — silently breaking line-item
-- descriptions and every other edit.
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.invoices
  add column if not exists payment_terms text;

notify pgrst, 'reload schema';
