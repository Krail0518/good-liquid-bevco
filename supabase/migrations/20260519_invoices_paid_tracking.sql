-- ============================================================
-- Invoice paid-tracking columns for Stripe webhook auto-mark-paid
-- ============================================================
-- Adds the columns the stripe-webhook edge function uses to stamp
-- an invoice as paid when Stripe fires checkout.session.completed:
--   - paid_at            — when the customer paid
--   - stripe_session_id  — the cs_xxx id for traceability/audit
--   - paid_method        — 'card' / 'us_bank_account' (ACH) / 'manual'
--   - paid_amount        — what Stripe actually collected (in dollars)
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.invoices
  add column if not exists paid_at            timestamptz,
  add column if not exists stripe_session_id  text,
  add column if not exists paid_method        text,
  add column if not exists paid_amount        numeric(12,2);

create index if not exists idx_invoices_stripe_session on public.invoices(stripe_session_id) where stripe_session_id is not null;

notify pgrst, 'reload schema';
