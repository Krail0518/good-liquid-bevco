-- ════════════════════════════════════════════════════════════════
-- Invoice amounts are stored in cents precision (GL-099)
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop trigger if exists invoices_amount_to_cents on public.invoices;
--   drop function if exists public.gl_invoice_amount_to_cents();
--   notify pgrst, 'reload schema';
--
-- WHAT WAS WRONG. invoices.amount is an unconstrained `numeric`, and the
-- invoice builder computes it in JavaScript floating point: a subtotal less a
-- percentage discount. So production held GL-1030 at 6491.999999999999 and
-- GL-1011 at 253.08999999999997. The screen rounds for display and nobody saw.
--
-- WHY IT MATTERS. The payment ledger (invoice_payments.amount is numeric(12,2))
-- refuses a payment that would take an invoice past its amount, and marks an
-- invoice paid only when the ledger covers it:
--
--   6492.00 > 6491.999999999999   -> the full payment is refused as an overpayment
--   6491.99 >= 6491.999999999999  -> false, so paying a cent less never settles it
--
-- Proven against production on 2026-09-16 with the literal values, without
-- writing anything. GL-1030 is a live pending invoice; paid through Stripe, the
-- card would be charged and the webhook's ledger insert rejected.
--
-- THE FIX. The builder now rounds (invoice-patches.js), but it is not the only
-- writer: the legacy invoice form, credit memos, late fees and edge functions
-- all set amount. A BEFORE trigger rounds for every one of them. It is named to
-- sort before invoices_guard_paid_state, so the guard sees the rounded value.
--
-- WHAT THIS DOES NOT DO. It does not rewrite existing rows. GL-1030 and GL-1011
-- are real invoices and changing them is the owner's call; either is corrected
-- the next time it is saved (this trigger fires on any update of amount), or by
--   update public.invoices set amount = round(amount, 2)
--    where amount <> round(amount, 2);
-- GL-1011 is already paid with a ledger net of 253.09, so rounding it is safe.
-- ════════════════════════════════════════════════════════════════

create or replace function public.gl_invoice_amount_to_cents()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.amount is not null then
    new.amount := pg_catalog.round(new.amount, 2);
  end if;
  return new;
end
$$;

-- Reached only by the trigger.
revoke all on function public.gl_invoice_amount_to_cents() from public, anon, authenticated;

drop trigger if exists invoices_amount_to_cents on public.invoices;
create trigger invoices_amount_to_cents
  before insert or update of amount on public.invoices
  for each row execute function public.gl_invoice_amount_to_cents();

notify pgrst, 'reload schema';
