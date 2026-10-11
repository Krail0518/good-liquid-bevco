-- ════════════════════════════════════════════════════════════════
-- Inbound alarms: no customer message goes unnoticed again
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   select cron.unschedule(jobid) from cron.job
--    where jobname in ('inbound-heartbeat', 'notification-log-prune');
--   drop trigger if exists on_customer_requests_insert_notify on public.customer_requests;
--   drop function if exists public.trigger_notify_customer_requests();
--   drop function if exists public.gl_inbound_heartbeat_stats();
--   drop table if exists public.notification_log;
--   (notify-deal, gmail-sync and inbound-heartbeat tolerate the table being
--   gone: logging is best effort and the heartbeat reports the missing stats.)
--
-- WHY
-- From 2026-08-28 to 2026-10-11 every website quote request failed and
-- nothing said so (~60 leads; fixed in #482). The same audit found three more
-- quiet holes: portal requests (customer_requests) raised no alert at all;
-- client email replies imported by gmail-sync raised none either; and alert
-- emails that hit Gmail's 429 were dropped without a retry. All of them were
-- silent because nothing checked that the pipes were flowing.
--
-- WHAT THIS ADDS
--   1. public.notification_log — one row per alert dispatch (notify-deal),
--      per Gmail sync run (gmail-sync) and per daily check
--      (inbound-heartbeat): which channels delivered and the error text.
--      SERVER-ONLY: RLS on with NO policies and every privilege revoked from
--      anon/authenticated, so only service_role (the edge functions) and
--      SECURITY DEFINER code can touch it. It holds event names and channel
--      error text, never message content.
--   2. trigger_notify_customer_requests — per statement, like
--      trigger_notify_new_deals: 1-3 new requests → one 'portal_request' alert
--      each (client, type, subject, first 200 chars); 4+ → one summary.
--      Rate limit (CLAUDE.md rule 7): a portal customer can insert requests
--      at will, so a client's requests beyond 5 in an hour are not alerted
--      individually, and a 4+ summary is skipped once 20 requests already
--      arrived that hour; they still land in the table and the daily counts.
--   3. gl_inbound_heartbeat_stats() — the last-24h counts and channel health
--      the inbound-heartbeat function sends to Telegram each morning.
--      service_role only.
--   4. pg_cron: 'inbound-heartbeat' daily at 11:30 UTC (7:30 ET in summer,
--      6:30 in winter), every day including weekends because leads arrive on
--      weekends; same auth pattern as attention-digest (anon key as bearer
--      for the gateway, Vault gl_cron_secret as x-cron-secret for
--      isCronCall). 'notification-log-prune' keeps 90 days.
--
-- PERMISSIONS: no existing policy or grant changes. New objects are
-- service_role / postgres only. Requires the inbound-heartbeat function to be
-- deployed (the cron job 404s harmlessly until it is).

-- ── 1. notification_log ─────────────────────────────────────────
create table if not exists public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null,           -- 'notify-deal' | 'gmail-sync' | 'inbound-heartbeat'
  event       text not null,
  ok          boolean not null,        -- reached Mike on at least one reliable channel / run succeeded
  whatsapp_ok boolean,                 -- null = not attempted
  telegram_ok boolean,
  email_ok    boolean,
  error       text,
  detail      jsonb
);
create index if not exists idx_notification_log_source_time
  on public.notification_log (source, created_at desc);

alter table public.notification_log enable row level security;
-- Deliberately NO policies: nobody but service_role and definer code.
revoke all on table public.notification_log from public, anon, authenticated;
grant select, insert, delete on table public.notification_log to service_role;

-- ── 2. Portal request alerts ────────────────────────────────────
create or replace function public.trigger_notify_customer_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret  text;
  v_n       integer;
  v_names   text;
  v_recent  integer;
  r         record;
  v_url     constant text := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal';
  -- The publishable (anon) key, same as every other notify trigger; the
  -- Vault secret in the body is what authorizes the call.
  v_headers constant jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE'
  );
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
  exception when others then
    v_secret := '';
  end;
  if v_secret is null or v_secret = '' then
    return null;
  end if;

  select count(*) into v_n from new_rows;

  if v_n = 0 then
    return null;
  elsif v_n <= 3 then
    for r in
      select nr.client_id, nr.kind, nr.subject, nr.body, c.name as client_name
        from new_rows nr
        left join public.clients c on c.id = nr.client_id
       order by nr.created_at
    loop
      -- Rule 7: past 5 requests from one client in an hour, stop alerting
      -- one by one (the rows are kept and counted in the daily check).
      select count(*) into v_recent
        from public.customer_requests
       where client_id is not distinct from r.client_id
         and created_at > now() - interval '1 hour';
      continue when v_recent > 5;

      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object(
          'event',  'portal_request',
          'secret', v_secret,
          'data',   jsonb_build_object(
            'client',  coalesce(r.client_name, ''),
            'kind',    coalesce(r.kind, ''),
            'subject', left(coalesce(r.subject, ''), 200),
            'body',    left(coalesce(r.body, ''), 400)
          )
        ),
        headers := v_headers
      );
    end loop;
  else
    -- A batch summary is skipped too once 20+ requests already arrived in the
    -- hour before this insert, so repeated bulk inserts cannot flood Telegram.
    select count(*) into v_recent
      from public.customer_requests
     where created_at > now() - interval '1 hour';
    if v_recent - v_n >= 20 then
      return null;
    end if;
    select string_agg(label, ', ') into v_names
      from (
        select distinct coalesce(nullif(c.name, ''), 'Unknown client') as label
          from new_rows nr
          left join public.clients c on c.id = nr.client_id
         limit 5
      ) first_five;
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
        'event',  'portal_request',
        'secret', v_secret,
        'data',   jsonb_build_object('count', v_n::text, 'names', coalesce(v_names, ''))
      ),
      headers := v_headers
    );
  end if;

  return null;
exception when others then
  return null;  -- never block the customer's request
end;
$$;

revoke all on function public.trigger_notify_customer_requests() from public, anon, authenticated;
grant execute on function public.trigger_notify_customer_requests() to service_role;

drop trigger if exists on_customer_requests_insert_notify on public.customer_requests;
create trigger on_customer_requests_insert_notify
  after insert on public.customer_requests
  referencing new table as new_rows
  for each statement
  execute function public.trigger_notify_customer_requests();

-- ── 3. Heartbeat stats ──────────────────────────────────────────
create or replace function public.gl_inbound_heartbeat_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  nl as (
    select created_at, ok, whatsapp_ok, telegram_ok, email_ok, error
      from public.notification_log
     where source = 'notify-deal' and created_at > now() - interval '30 days'
  ),
  per as (
    select x.k, nl.created_at, x.v,
           substring(nl.error from x.k || ': ([^|]*)') as err
      from nl
      cross join lateral (values ('telegram', nl.telegram_ok),
                                 ('email',    nl.email_ok),
                                 ('whatsapp', nl.whatsapp_ok)) as x(k, v)
     where x.v is not null
  ),
  agg as (
    select k,
           count(*) filter (where created_at > now() - interval '24 hours')            as attempts_24h,
           count(*) filter (where v and created_at > now() - interval '24 hours')      as ok_24h,
           coalesce(bool_or(v), false)                                                 as ok_30d,
           max(created_at) filter (where v)                                            as last_ok_at,
           (array_agg(btrim(err) order by created_at desc) filter (where not v))[1]    as last_error
      from per
     group by k
  ),
  chan as (
    select coalesce(jsonb_object_agg(a.k, jsonb_build_object(
             'attempts_24h', a.attempts_24h,
             'ok_24h',       a.ok_24h,
             'ok_30d',       a.ok_30d,
             'last_ok_at',   a.last_ok_at,
             'last_error',   a.last_error,
             'attempts_since_ok', (select count(*) from per p
                                    where p.k = a.k and p.created_at > coalesce(a.last_ok_at, '-infinity'))
           )), '{}'::jsonb) as j
      from agg a
  )
  select jsonb_build_object(
    'generated_at',          now(),
    'quotes_24h',            (select count(*) from public.contact_submissions where created_at > now() - interval '24 hours'),
    'last_quote_at',         (select max(created_at) from public.contact_submissions),
    'deals_24h',             (select count(*) from public.deals where created_at > now() - interval '24 hours'),
    'tours_24h',             (select count(*) from public.bookings where created_at > now() - interval '24 hours'),
    'tours_pending',         (select count(*) from public.bookings where status = 'pending'),
    'onboarding_24h',        (select count(*) from public.onboarding where submitted_at > now() - interval '24 hours'),
    'portal_requests_24h',   (select count(*) from public.customer_requests where created_at > now() - interval '24 hours'),
    'portal_requests_open',  (select count(*) from public.customer_requests where status in ('new', 'in_progress')),
    'inbound_emails_24h',    (select count(*) from public.email_log
                               where direction = 'inbound' and coalesce(sent_at, created_at) > now() - interval '24 hours'),
    'inbound_client_emails_24h', (select count(*) from public.email_log
                               where direction = 'inbound' and client_id is not null
                                 and coalesce(sent_at, created_at) > now() - interval '24 hours'),
    'alerts_24h',            (select count(*) from nl where created_at > now() - interval '24 hours'),
    'alerts_undelivered_24h',(select count(*) from nl where created_at > now() - interval '24 hours' and not ok),
    'channels',              (select j from chan),
    'gmail_sync', jsonb_build_object(
      'last_ok_at',    (select max(created_at) from public.notification_log
                         where source = 'gmail-sync' and ok),
      'last_error_at', (select max(created_at) from public.notification_log
                         where source = 'gmail-sync' and not ok),
      'last_error',    (select error from public.notification_log
                         where source = 'gmail-sync' and not ok
                         order by created_at desc limit 1)
    )
  );
$$;

revoke all on function public.gl_inbound_heartbeat_stats() from public, anon, authenticated;
grant execute on function public.gl_inbound_heartbeat_stats() to service_role;

-- ── 4. Schedules ────────────────────────────────────────────────
do $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname in ('inbound-heartbeat', 'notification-log-prune') loop
    perform cron.unschedule(v_jobid);
  end loop;
end $$;

select cron.schedule(
  'inbound-heartbeat',
  '30 11 * * *',
  $cron$
    -- Authorization (anon key) gets past the gateway's verify_jwt; without it
    -- the call is rejected before the function runs while pg_cron still logs
    -- "succeeded" (the attention-digest lesson). x-cron-secret authorizes the
    -- caller inside the function (isCronCall).
    select net.http_post(
      url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/inbound-heartbeat',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gl_cron_secret')
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 60000
    );
  $cron$
);

select cron.schedule(
  'notification-log-prune',
  '15 3 * * 0',
  $cron$ delete from public.notification_log where created_at < now() - interval '90 days'; $cron$
);
