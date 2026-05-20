-- ============================================================
-- Daily activity digest — pg_cron schedule + opt-out column
-- ============================================================
-- Adds:
--   1. `profiles.notify_daily_digest` — opt-out flag (default true).
--      Set false for any staff user who doesn't want the morning email.
--   2. A pg_cron job that hits the `daily-digest` Edge Function once a
--      day at 11:00 UTC (= 7:00 AM ET in summer, 6:00 AM ET in winter).
--      Function picks up its own recipients, builds the HTML, and sends.
--
-- Requires:
--   • pg_net extension (for `net.http_post`)
--   • The `daily-digest` Edge Function to be deployed BEFORE this
--     migration runs. If it isn't, the cron job will still be created;
--     it'll just 404 each night until the function is live.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
grant usage on schema cron to postgres;

-- ── 1) Per-user opt-out ────────────────────────────────────────────
alter table public.profiles
  add column if not exists notify_daily_digest boolean not null default true;

comment on column public.profiles.notify_daily_digest is
  'When true, this staff user receives the morning Daily Digest email. Default true. Edit via Profile → Notifications or flip directly with SQL.';

-- ── 2) Schedule the cron job ───────────────────────────────────────
-- Drop any prior schedule with the same name so re-running this
-- migration doesn't accumulate duplicate jobs.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'daily-digest' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

-- The Authorization header uses the project anon key (or a dedicated
-- digest secret if you want to lock it down further). Since the function
-- is deployed with --no-verify-jwt, the bearer is technically optional —
-- it's included for parity with the rest of the cron-driven functions
-- and so logs show a sensible "actor".
--
-- HARD-CODES the project URL — there's only one Good Liquid Supabase
-- project, and pg_cron jobs run as `postgres` so they can't read app
-- settings without help.
select cron.schedule(
  'daily-digest',
  '0 11 * * *',
  $cron$
    select net.http_post(
      url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/daily-digest',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('source','pg_cron'),
      timeout_milliseconds := 60000
    );
  $cron$
);

notify pgrst, 'reload schema';
