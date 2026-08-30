-- ============================================================
-- Backfill email_log.invoice_number from the subject line
-- ============================================================
-- Rows logged before PR #81 (auto-tag) have invoice_number=null and
-- don't appear under their invoice's Activity tab. This pulls the
-- "GL-####" pattern out of the subject and stamps invoice_number.
--
-- Idempotent: only touches rows where invoice_number IS NULL.
-- ============================================================

update public.email_log
set invoice_number = substring(subject from 'GL-[0-9]+')
where invoice_number is null
  and subject ~ 'GL-[0-9]+';

-- Also link invoice_id where possible by matching the number to invoices
update public.email_log el
set invoice_id = inv.id
from public.invoices inv
where el.invoice_id is null
  and el.invoice_number = inv.invoice_number;
