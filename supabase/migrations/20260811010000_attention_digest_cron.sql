-- ============================================================
-- Attention digest — weekday-morning pg_cron schedule
-- ============================================================
-- Hits the `attention-digest` Edge Function every weekday at 12:00 UTC
-- (~7-8 AM ET). The function ranks open deals by urgency and sends Mike a
-- WhatsApp + email of who needs him today; it stays silent when nothing is
-- urgent, so no morning spam.
--
-- Auth: passes the Vault-held gl_cron_secret as x-cron-secret, verified by the
-- function via isCronCall() / gl_check_cron_secret().
--
-- Requires: pg_cron + pg_net, and the attention-digest function deployed first
-- (the job is created regardless; it just 404s until the function is live).
--
-- ROLLBACK: select cron.unschedule((select jobid from cron.job where jobname='attention-digest'));
-- Idempotent. Safe to re-run.
-- ============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
grant usage on schema cron to postgres;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'attention-digest' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'attention-digest',
  '0 12 * * 1-5',
  $cron$
    select net.http_post(
      url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/attention-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
      ),
      body := jsonb_build_object('source','pg_cron'),
      timeout_milliseconds := 120000
    );
  $cron$
);

notify pgrst, 'reload schema';
