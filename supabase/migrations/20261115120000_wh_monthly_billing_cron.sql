-- ════════════════════════════════════════════════════════════════
-- Warehouse storage: invoice every client automatically on the 1st
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   select cron.unschedule(jobid) from cron.job where jobname = 'wh-monthly-billing';
--   (Invoices already sent stay; they are ordinary invoices rows.)
--
-- WHY
-- Warehouse billing was manual: open Billing, 🧾 Create invoice, then send it
-- from the invoice. On 2026-11-15 two October invoices (GL-20261111 Atlas
-- canning, GL-20261112 PERICO) were created and never emailed, and neither
-- month was marked billed. Mike asked for the invoices to go out on the 1st
-- of every month without anyone touching them.
--
-- WHAT THIS ADDS
--   pg_cron 'wh-monthly-billing' at 14:00 UTC on day 1 (9am EST / 10am EDT):
--   calls the wh-monthly-billing edge function, which bills the month that
--   just ended, emails each invoice from the company Gmail, marks the month
--   billed and sends Mike a Telegram summary. Same auth pattern as
--   inbound-heartbeat: the publishable key gets past the gateway, the Vault
--   gl_cron_secret (x-cron-secret) authorizes the caller (isCronCall).
--   The function skips any client already billed for the month, so a double
--   fire or a re-run never bills twice.
--
-- PERMISSIONS: no policy or grant changes. The function runs as service_role.

select cron.schedule(
  'wh-monthly-billing',
  '0 14 1 * *',
  $cron$
    select net.http_post(
      url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/wh-monthly-billing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 120000
    );
  $cron$
);
