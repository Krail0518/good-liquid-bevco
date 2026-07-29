-- Scheduled-job auth, redesigned so no human ever hand-carries a secret again.
--
-- NOTE: this migration was applied directly to production (via the Supabase
-- management API) on 2026-07-29 as version 20260729000629. This file mirrors
-- it exactly so `supabase db push` treats it as already applied and the repo
-- stays the source of truth.
--
-- Why: the pg_cron jobs were calling the edge functions with a literal
-- placeholder ('PASTE_SECRET_HERE') where a shared secret belonged, so every
-- scheduled run got 401 and follow-up email silently stopped. The root cause
-- was the design: the secret had to be copied between two dashboards by hand.
-- This migration makes the database the only holder of the secret:
--
--   * The secret is GENERATED inside Postgres and stored in Supabase Vault —
--     it never appears in chat logs, SQL files, or a clipboard.
--   * pg_cron job commands read it from Vault at send time.
--   * Edge functions verify a presented value via gl_check_cron_secret(),
--     a service-role-only RPC, so the value itself never leaves the database.
--
-- Also adds gl_secret_get / gl_secret_set (service-role-only Vault access,
-- used by the in-app "Connect Gmail" flow) and gl_cron_health() so staff can
-- see from the admin panel whether the scheduled jobs are actually landing.

-- 1) The cron secret: generated in-database, stored in Vault. gen_random_uuid()
--    is core Postgres, so this needs no extension beyond vault itself.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'gl_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'gl_cron_secret',
      'Shared secret: pg_cron -> edge functions. Generated in-db; never exported.'
    );
  end if;
end $$;

-- 2) Verification RPC. Service-role only: the edge functions hold that key,
--    browsers and portal customers do not.
create or replace function public.gl_check_cron_secret(candidate text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(candidate, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'gl_cron_secret' and decrypted_secret = candidate
  );
$$;

revoke all on function public.gl_check_cron_secret(text) from public;
revoke all on function public.gl_check_cron_secret(text) from anon;
revoke all on function public.gl_check_cron_secret(text) from authenticated;
grant execute on function public.gl_check_cron_secret(text) to service_role;

-- 3) Generic Vault get/set for the gl_* namespace (service-role only). The
--    Gmail connect flow stores its OAuth credential set through these, so
--    those values also never transit a human clipboard. An empty value is
--    allowed on set: it is how a stale credential is cleared.
create or replace function public.gl_secret_get(p_name text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_name and p_name like 'gl\_%';
$$;

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

revoke all on function public.gl_secret_get(text) from public;
revoke all on function public.gl_secret_get(text) from anon;
revoke all on function public.gl_secret_get(text) from authenticated;
grant execute on function public.gl_secret_get(text) to service_role;

revoke all on function public.gl_secret_set(text, text) from public;
revoke all on function public.gl_secret_set(text, text) from anon;
revoke all on function public.gl_secret_set(text, text) from authenticated;
grant execute on function public.gl_secret_set(text, text) to service_role;

-- 4) Health check for the admin panel: staff can see whether scheduled jobs
--    are green without opening the Supabase dashboard. A cron run "succeeding"
--    only means the HTTP request was queued — the http section carries the
--    real delivery outcome, which is exactly the signal that was invisible
--    while the jobs 401'd for hours.
create or replace function public.gl_cron_health()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and coalesce(status, 'active') <> 'inactive'
  ) or exists (
    select 1 from public.customer_users
    where auth_user_id = auth.uid() and active
  ) then
    raise exception 'staff only';
  end if;

  select jsonb_build_object(
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
