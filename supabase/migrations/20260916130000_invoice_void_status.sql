-- ════════════════════════════════════════════════════════════════
-- Voiding an invoice works again (GL-102)
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   (only safe while no invoice is 'voided')
--   alter table public.invoices drop constraint invoices_status_check;
--   alter table public.invoices add constraint invoices_status_check
--     check (status = any (array['draft','pending','paid','overdue']));
--   create or replace function public.gl_invoice_derived_status(...)  -- the
--     20260831180000 body, i.e. this one without the 'voided' branch
--   notify pgrst, 'reload schema';
--
-- WHAT WAS WRONG. The invoice detail has a 🚫 Void button (accounting.js) that
-- sets status='voided' with void_reason and voided_at — columns added for it in
-- 20260531000000. Two later layers never admitted that status:
--   * invoices_status_check allows only draft|pending|paid|overdue;
--   * gl_invoice_derived_status() (20260831180000), the single statement of the
--     payment invariant, projects every non-credit-memo invoice to
--     paid|draft|overdue|pending, so the guard raises
--       "status voided on … contradicts the ledger … projects to pending".
-- Every void since 2026-08-31 failed with that error. Proven with a rolled-back
-- probe on 2026-09-16. No invoice is voided today.
--
-- THE RULE ADDED, deliberately narrow:
--   An invoice may be (and stays) 'voided' only while the ledger holds nothing
--   against it — net within the half-cent tolerance of zero. Money received is
--   the truth: if a payment lands on a voided invoice, the same projection makes
--   it paid/pending again rather than hiding the money. To void something that
--   was paid, refund it first; the ledger then nets to zero.
--   Credit memos are unchanged. Nothing else in the invariant moves.
-- ════════════════════════════════════════════════════════════════

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status = any (array['draft'::text, 'pending'::text, 'paid'::text, 'overdue'::text, 'voided'::text]));

create or replace function public.gl_invoice_derived_status(
  p_amount         numeric,
  p_is_credit_memo boolean,
  p_current_status text,
  p_net            numeric
)
returns text
language sql
immutable
set search_path = public, extensions
as $derived$
  select case
    when coalesce(p_is_credit_memo, false) then p_current_status
    -- GL-102: a void stands only while nothing has been paid against it.
    when p_current_status = 'voided'
         and abs(coalesce(p_net, 0)) <= public.gl_payment_tolerance()  then 'voided'
    when p_amount > 0 and p_net >= p_amount - public.gl_payment_tolerance() then 'paid'
    when p_current_status = 'draft'   then 'draft'
    when p_current_status = 'overdue' then 'overdue'
    else 'pending'
  end;
$derived$;

notify pgrst, 'reload schema';
