-- Review fixes for 20260729000629 (applied to production 2026-07-29, same day):
--
-- (a) email_schedule.claimed_at — atomic-claim column so concurrent
--     email-scheduler runners (pg_cron + the CRM's belt-and-braces ping from
--     each open tab) can never double-send the same follow-up.
-- (b) gl_secret_set refuses to touch gl_cron_secret — the generic setter is
--     for the Gmail credential namespace, not the cron-auth trust anchor.
-- (c) gl_cron_health: admins/super-users only (it returns raw response
--     bodies), and it now reports the one signal that directly answers "is
--     scheduled mail going out" — how many due follow-ups sit unsent past 30
--     minutes. The raw http list stays but is labeled all-sources in the UI,
--     because net._http_response is shared with the tour/deal alert triggers.
-- (d) Mirror the production pg_cron job commands (Vault-read secret + anon
--     Bearer) so an environment rebuilt from migrations doesn't recreate the
--     silent-401 outage this replaced. The Bearer value is the project's
--     public anon key — the same class of key that ships in the site's HTML.

-- (a) claim column
alter table public.email_schedule add column if not exists claimed_at timestamptz;

-- (b) protect the cron secret from the generic setter
create or replace function public.gl_secret_set(p_name text, p_value text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare sid uuid;
begin
  if p_name is null or p_name not like 'gl\_%' then
    raise exception 'secret name must start with gl_';
  end if;
  if p_name = 'gl_cron_secret' then
    raise exception 'gl_cron_secret is managed by migrations only';
  end if;
  if p_value is null then
    raise exception 'secret value may not be null (use empty string to clear)';
  end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(sid, p_value);
  end if;
end $$;

revoke all on function public.gl_secret_set(text, text) from public;
revoke all on function public.gl_secret_set(text, text) from anon;
revoke all on function public.gl_secret_set(text, text) from authenticated;
grant execute on function public.gl_secret_set(text, text) to service_role;

-- (c) health: admin-gated, plus the overdue-followups signal
create or replace function public.gl_cron_health()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and coalesce(status, 'active') <> 'inactive'
      and (role = 'admin' or is_super_user)
  ) then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'overdue', (
      select count(*) from public.email_schedule
      where status = 'pending' and send_at < now() - interval '30 minutes'
    ),
    'jobs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', j.jobname,
        'schedule', j.schedule,
        'active', j.active,
        'last_status', d.status,
        'last_run', d.start_time,
        'last_message', left(d.return_message, 200)
      ) order by j.jobid), '[]'::jsonb)
      from cron.job j
      left join lateral (
        select status, start_time, return_message
        from cron.job_run_details
        where jobid = j.jobid
        order by start_time desc
        limit 1
      ) d on true
    ),
    'http', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'status', r.status_code,
        'at', r.created,
        'timed_out', r.timed_out,
        'body', left(r.content, 160)
      ) order by r.created desc), '[]'::jsonb)
      from (
        select status_code, created, timed_out, content
        from net._http_response
        order by created desc
        limit 12
      ) r
    )
  ) into result;
  return result;
end $$;

revoke all on function public.gl_cron_health() from public;
revoke all on function public.gl_cron_health() from anon;
grant execute on function public.gl_cron_health() to authenticated;
grant execute on function public.gl_cron_health() to service_role;

-- (d) the three scheduled jobs, exactly as they run in production: secret read
--     from Vault at send time, anon Bearer for the functions gateway.
do $mig$
declare
  jid bigint;
  anon_bearer constant text := 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  cmd text;
begin
  cmd := format($cmd$
  select net.http_post(
    url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/email-scheduler',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','%s',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cmd$, anon_bearer);
  select jobid into jid from cron.job where jobname = 'email-scheduler-every-15min';
  if jid is null then perform cron.schedule('email-scheduler-every-15min', '*/15 * * * *', cmd);
  else perform cron.alter_job(jid, command := cmd);
  end if;

  cmd := format($cmd$
  select net.http_post(
    url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','%s',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
    ),
    body := jsonb_build_object('source','pg_cron'),
    timeout_milliseconds := 60000
  );
$cmd$, anon_bearer);
  select jobid into jid from cron.job where jobname = 'daily-digest';
  if jid is null then perform cron.schedule('daily-digest', '0 11 * * *', cmd);
  else perform cron.alter_job(jid, command := cmd);
  end if;

  cmd := format($cmd$
  select net.http_post(
    url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/gmail-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','%s',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
    ),
    body := jsonb_build_object('days', 1, 'max', 40),
    timeout_milliseconds := 55000
  );
$cmd$, anon_bearer);
  select jobid into jid from cron.job where jobname = 'gmail-sync-hourly';
  if jid is null then perform cron.schedule('gmail-sync-hourly', '0 * * * *', cmd);
  else perform cron.alter_job(jid, command := cmd);
  end if;
end $mig$;
