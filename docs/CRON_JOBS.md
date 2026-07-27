# Scheduled jobs (pg_cron)

Reference for the database cron jobs that call edge functions, and how they are
authenticated. Written after finding that two of them were running with no
authentication at all.

## The jobs

| Name | Schedule | Calls | Purpose |
|---|---|---|---|
| `email-scheduler-every-15min` | `*/15 * * * *` | `email-scheduler` | Sends queued follow-ups from `email_schedule` |
| `daily-digest` | `0 11 * * *` | `daily-digest` | Morning summary email to staff |
| `gmail-sync-hourly` | `0 * * * *` | `gmail-sync` | Files client/lead email into `email_log` |
| `mark-overdue-invoices` | `0 2 * * *` | *(none — plain SQL)* | Flips due invoices to `overdue` |

`mark-overdue-invoices` needs no auth discussion: it is a SQL `update`, not an
HTTP call.

## Authentication: how it works, and the trap

The HTTP-calling functions accept a shared secret in an `x-cron-secret` header,
checked against the `CRON_SECRET` edge-function secret.

**The trap:** `daily-digest` and `email-scheduler` only enforce the secret *if
one is configured* — the check is skipped when `CRON_SECRET` is unset. That was
deliberate, to avoid breaking working jobs at the time the check was added, but
it means an unset secret leaves those endpoints callable by anyone who knows the
URL. They were running that way, which is exactly why they succeeded while
sending no auth header at all.

`gmail-sync` is stricter: with no secret set it falls through to requiring a
signed-in staff user, so a cron call gets a 401. An unset `CRON_SECRET` makes
its scheduled run impossible rather than merely unauthenticated.

**So `CRON_SECRET` must be set, and all three jobs must send it.** Set the
secret and update the jobs in one sitting: the moment the secret exists, any job
not sending it starts getting rejected.

## Setting it up

1. Generate a value inside the database, so it never travels anywhere:

   ```sql
   select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as cron_secret;
   ```

2. Save it as `CRON_SECRET` in Supabase → **Edge Functions → Secrets**.

3. Re-create the three jobs with the header. Re-using the same job name replaces
   the existing job. Replace all three `PASTE_SECRET_HERE`:

   ```sql
   select cron.unschedule('email-scheduler-every-15min');
   select cron.unschedule('daily-digest');
   select cron.unschedule('gmail-sync-hourly');

   select cron.schedule('email-scheduler-every-15min', '*/15 * * * *', $cron$
     select net.http_post(
       url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/email-scheduler',
       headers := jsonb_build_object('Content-Type','application/json',
                                     'x-cron-secret','PASTE_SECRET_HERE'),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     );
   $cron$);

   select cron.schedule('daily-digest', '0 11 * * *', $cron$
     select net.http_post(
       url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/daily-digest',
       headers := jsonb_build_object('Content-Type','application/json',
                                     'x-cron-secret','PASTE_SECRET_HERE'),
       body := jsonb_build_object('source','pg_cron'),
       timeout_milliseconds := 60000
     );
   $cron$);

   select cron.schedule('gmail-sync-hourly', '0 * * * *', $cron$
     select net.http_post(
       url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/gmail-sync',
       headers := jsonb_build_object('Content-Type','application/json',
                                     'x-cron-secret','PASTE_SECRET_HERE'),
       body := jsonb_build_object('days', 1, 'max', 40),
       timeout_milliseconds := 55000
     );
   $cron$);
   ```

## Checking whether a job actually works

Three levels, and only the third is conclusive.

```sql
-- 1. Does it exist and is it enabled?
select jobid, jobname, schedule, active from cron.job order by jobid;

-- 2. Is it firing? ("succeeded" here only means the SQL ran.)
select jobid, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;

-- 3. What did the function actually reply? THIS is the real answer.
select status_code, left(content::text, 200) as response, created
from net._http_response order by created desc limit 10;
```

**Why level 2 misleads:** `net.http_post` returns a request id immediately and
does not wait for the response, so `cron.job_run_details` reports `succeeded`
even when the function rejected the call with a 401. Always finish at level 3.

Reading level 3:

| `status_code` | Meaning |
|---|---|
| `200` | Working |
| `401` | Firing, but rejected — the job's secret does not match `CRON_SECRET` |
| `403` | Authenticated, but Gmail read scope missing (`gmail-sync` only) |
| `NULL` | pg_net gave up waiting. Raise `timeout_milliseconds`, or reduce the work per run |
| no rows | `pg_net` is not installed, so the call never left the database |

A `NULL` does not necessarily mean the work failed — Supabase keeps running the
function after pg_net stops listening. It means the outcome is unverifiable,
which is reason enough to fix it.

`net._http_response` also carries responses from *all* jobs, so match on the
timestamp and the response shape. `{"processed":0}` is `email-scheduler`;
`gmail-sync` replies with `{"ok":true,...}` and sync counts.

## Do you actually need the hourly Gmail sync?

Probably not. The CRM syncs itself: a short sweep shortly after it opens, then
every 15 minutes while the tab stays open, plus a per-contact refresh whenever a
client or lead is opened. The cron job only covers days the CRM is never opened
at all.

Setting `CRON_SECRET` matters regardless — that is the part that closes the open
endpoints.

To remove the job: `select cron.unschedule('gmail-sync-hourly');`
