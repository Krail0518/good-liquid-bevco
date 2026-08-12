-- ── Hourly cron for the lead-automations watchdog ────────────────────────────
-- 2026-08-12
--
-- Runs lead-automations every hour: escalates leads past the first-reply SLA and
-- drafts follow-ups for leads that have gone quiet. Same call shape as the other
-- cron jobs (20260721_tour_alerts.sql / gmail-sync-hourly): the anon JWT gets it
-- through the gateway and the Vault gl_cron_secret authorizes it inside
-- (isCronCall). Apply AFTER the function is deployed.
--
-- ROLLBACK: select cron.unschedule('lead-automations-hourly');

select cron.unschedule('lead-automations-hourly')
where exists (select 1 from cron.job where jobname = 'lead-automations-hourly');

select cron.schedule('lead-automations-hourly', '0 * * * *', $$
  select net.http_post(
    url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/lead-automations',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
    ),
    body := jsonb_build_object('source','pg_cron'),
    timeout_milliseconds := 120000
  );
$$);
