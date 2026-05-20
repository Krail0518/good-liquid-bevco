-- ============================================================
-- Auto-mark overdue invoices server-side (pg_cron daily job)
-- ============================================================
-- Without this, status='pending' invoices stayed pending forever
-- even when due_date had passed. The dashboard was patched client-
-- side to compute effective overdue, but that's a band-aid — RLS-
-- gated queries, reports, and reminders all read the raw column.
-- This nightly job is the real fix.
--
-- Runs at 2:00 AM UTC daily (~ 10 PM EST in winter, 9 PM EDT in summer).
-- Idempotent. Safe to re-run; only flips rows that aren't already overdue.
-- ============================================================

create extension if not exists pg_cron with schema extensions;
grant usage on schema cron to postgres;

-- Drop any prior schedule with the same name so re-running this
-- migration doesn't accumulate duplicate jobs.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'mark-overdue-invoices' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'mark-overdue-invoices',
  '0 2 * * *',
  $cron$
    update public.invoices
       set status = 'overdue',
           updated_at = now()
     where status = 'pending'
       and due_date is not null
       and due_date < current_date
  $cron$
);

-- One-shot catch-up: flip any already-overdue rows right now so the
-- dashboard reflects truth immediately, before the first 2am run.
update public.invoices
   set status = 'overdue',
       updated_at = now()
 where status = 'pending'
   and due_date is not null
   and due_date < current_date;

notify pgrst, 'reload schema';
