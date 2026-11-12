-- ════════════════════════════════════════════════════════════════
-- Customer portal: a brand must not see its DRAFT invoices
-- ════════════════════════════════════════════════════════════════
-- Draft invoices are staff working copies: not sent, amounts and lines may
-- still change. The portal listed them anyway, with PDF / View, because
-- portal-customer.js selected every invoice for the client and policy
-- "invoices customer self" (20260518000004) allows every row of the
-- customer's own client. Recorded as a KNOWN_FAILURE in
-- tests/click-every-button.test.cjs ("billing hides DRAFT invoices").
--
-- Hiding them in the page alone is not enough: a customer holds a session
-- and can query invoices directly. So, per CLAUDE.md rule 3 (constrain,
-- don't rewrite), one RESTRICTIVE policy, AND-ed with everything else:
--   • staff (an active profiles row, is_gl_staff())  — unchanged, all rows
--   • portal customers                                — own client, not draft
--   • self-registered stranger                        — still nothing (the
--     tenant guard already denies them every row)
--   • anon / edge functions (service_role)            — unaffected
--
-- SELECT only: customers have no business writing invoices, but that is a
-- separate question and is not changed here.
--
-- ROLLBACK: drop policy "gl customer no draft invoices" on public.invoices;

drop policy if exists "gl customer no draft invoices" on public.invoices;
create policy "gl customer no draft invoices" on public.invoices
  as restrictive
  for select
  to authenticated
  using (public.is_gl_staff() or status is distinct from 'draft');
