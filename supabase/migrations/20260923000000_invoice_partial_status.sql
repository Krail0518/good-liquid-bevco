-- Invoices can be partly paid, and say so (GL-126)
--
-- The ledger already handled partial payments: invoice_payments takes any
-- amount, gl_record_manual_payment refuses more than the balance, and the
-- trigger keeps invoices.paid_amount current. What was missing is that the
-- STATUS had nowhere to say it. An invoice sat at 'pending' whether nothing
-- had been paid or all but ten dollars had, so a partial payment was invisible
-- outside the payments table.
--
-- This adds 'partial' to the allowed statuses and derives it from the ledger,
-- so it cannot drift from the payments the way a hand-set flag would.
--
-- PRECEDENCE, deliberately chosen:
--   'paid'    wins over everything — the balance is settled.
--   'draft'   and 'voided' are preserved; a partial payment must not
--             resurrect a voided invoice or promote a draft.
--   'partial' otherwise wins, INCLUDING over a stored 'overdue'. The owner
--             asked to see partial payments, and overdue-ness is not lost: it
--             is recomputed from due_date at display time by
--             effectiveInvoiceStatus(), and AR aging buckets by due date. The
--             cost is that a hand-set 'overdue' on an invoice that then takes
--             a partial payment stops being stored as overdue; it re-promotes
--             on its own once past the grace period.
--
-- Nothing is reclassified silently: at the time of writing, zero invoices are
-- partly paid, so the backfill below is a no-op that exists to make the
-- migration correct if replayed against data where that is not true.
--
-- ROLLBACK:
--   update public.invoices set status = 'pending' where status = 'partial';
--   alter table public.invoices drop constraint invoices_status_check;
--   alter table public.invoices add constraint invoices_status_check
--     check (status = any (array['draft','pending','paid','overdue','voided']));
--   -- then restore gl_invoice_derived_status from
--   -- 20260917160000_stripe_settlement_integrity.sql

begin;

-- 1. Allow the new status.
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status = any (array['draft','pending','paid','overdue','voided','partial']));

-- 2. Derive it. Same signature and IMMUTABLE contract as before, so the
--    trigger and every existing caller keep working unchanged.
create or replace function public.gl_invoice_derived_status(
  p_amount numeric, p_is_credit_memo boolean, p_current_status text, p_net numeric
) returns text
language sql
immutable
set search_path to 'public', 'extensions'
as $function$
  select case
    when coalesce(p_is_credit_memo, false) then p_current_status
    when p_current_status = 'voided'
         and abs(coalesce(p_net, 0)) <= public.gl_payment_tolerance()  then 'voided'
    when p_amount > 0 and p_net >= p_amount - public.gl_payment_tolerance() then 'paid'
    -- NEW: something has been paid, but not all of it. Sits above the draft /
    -- overdue passthroughs so a part-paid invoice reads as part-paid.
    when p_amount > 0 and coalesce(p_net, 0) > public.gl_payment_tolerance()
         and p_current_status <> 'draft'                              then 'partial'
    when p_current_status = 'draft'   then 'draft'
    when p_current_status = 'overdue' then 'overdue'
    else 'pending'
  end;
$function$;

-- 3. Bring existing rows in line with the rule above. Re-running is safe.
update public.invoices i
   set status = public.gl_invoice_derived_status(
                  i.amount, i.is_credit_memo, i.status, public.gl_ledger_net(i.invoice_number)),
       updated_at = now()
 where coalesce(i.is_credit_memo, false) = false
   and i.status not in ('voided', 'draft')
   and public.gl_invoice_derived_status(
         i.amount, i.is_credit_memo, i.status, public.gl_ledger_net(i.invoice_number)) <> i.status;

commit;
