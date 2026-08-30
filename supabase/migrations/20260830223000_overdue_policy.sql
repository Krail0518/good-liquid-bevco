-- ROLLBACK:
--   select cron.unschedule('mark-overdue-invoices');
--   select cron.schedule('mark-overdue-invoices', '0 2 * * *', $$
--     update public.invoices
--        set status = 'overdue', updated_at = now()
--      where status = 'pending' and due_date is not null and due_date < current_date
--   $$);
--   delete from public.app_settings
--    where key in ('invoice_overdue_enabled','invoice_overdue_grace_days');
--
--   Reverting restores same-day-after-due flagging. It does NOT un-mark rows
--   this job has already set to 'overdue'; nothing here or there deletes data.
--
-- GL-053 — the overdue policy is a business rule, so it becomes a setting.
--
-- WHAT CHANGES
-- An unpaid invoice is flagged overdue only once it is more than GRACE days
-- past due (21 — three weeks — by default), and only while the flag is switched
-- on at all. Both live in app_settings so staff can change them from the
-- Invoices page without a deploy, and so the nightly job and the browser read
-- the SAME policy instead of each carrying its own copy.
--
-- WHY THE JOB HAD TO CHANGE TOO
-- The client shows the effective status between nightly runs; the job writes
-- the stored one. If only the client honoured the grace period, this job would
-- keep writing 'overdue' the morning after an invoice fell due and the two
-- would disagree by three weeks — the same class of split that had the invoice
-- list showing one status in its badge and another in its buttons.
--
-- ON THE EXISTING ROWS
-- Rows already marked 'overdue' under the old rule are LEFT ALONE. Rewriting
-- historical invoice status is a business decision, not a migration's call, and
-- the client re-derives the display from the due date anyway, so they read
-- correctly in the UI without their stored value being edited.
--
-- The settings are seeded with ON CONFLICT DO NOTHING: if someone has already
-- set a policy, this must not stamp on it.

insert into public.app_settings (key, value)
values ('invoice_overdue_enabled', 'true'::jsonb),
       ('invoice_overdue_grace_days', '21'::jsonb)
on conflict (key) do nothing;

select cron.unschedule('mark-overdue-invoices');

select cron.schedule(
  'mark-overdue-invoices',
  '0 2 * * *',
  $job$
  update public.invoices i
     set status = 'overdue', updated_at = now()
   where i.status = 'pending'
     and i.due_date is not null
     -- Read the policy rather than hardcoding it, so the job and the browser
     -- can never drift apart. Defaults match the documented rule if a row is
     -- missing: enabled, three weeks.
     and coalesce(
           (select (value #>> '{}')::boolean
              from public.app_settings where key = 'invoice_overdue_enabled'),
           true)
     and i.due_date < current_date - coalesce(
           (select greatest((value #>> '{}')::int, 0)
              from public.app_settings where key = 'invoice_overdue_grace_days'),
           21)
  $job$
);
