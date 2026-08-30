-- A rate-limit counter for the Edge Functions that spend money.
--
-- ROLLBACK:
--   drop function if exists public.gl_rate_limit_hit(text, integer, integer);
--   drop table if exists public.edge_rate_limits;
--
-- WHY
-- ---
-- ai-proxy, mailgun-send, send-sms and dropbox-sign each call a paid vendor.
-- All four now require a staff session (that half was already fixed), so a
-- stranger cannot reach them — CLAUDE.md rule 7 is about what a stranger can
-- trigger, and it is satisfied.
--
-- What remains is the account that is not a stranger. A stolen or borrowed
-- staff session can loop any of these, and the cost lands on Mike: Anthropic
-- tokens, Mailgun sends, Twilio messages, Dropbox Sign envelopes. Authorization
-- decides WHO may call; it says nothing about how often, and these are the four
-- endpoints where "how often" has an invoice attached.
--
-- booking-confirm already throttles by counting recent rows. That works there
-- because bookings are themselves the thing being counted. These functions have
-- no such natural log, so they need somewhere to count.

create table if not exists public.edge_rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket, window_start)
);

-- Nothing in the browser may read or write this. The Edge Functions reach it
-- with the service-role key, which bypasses RLS; enabling it with no policy is
-- the "unreachable by design" shape, not an oversight.
alter table public.edge_rate_limits enable row level security;
revoke all on table public.edge_rate_limits from anon, authenticated;

-- Fixed windows rather than a sliding log: one row per bucket per window, so
-- the table cannot grow with traffic and the counter is a single upsert.
create or replace function public.gl_rate_limit_hit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w timestamptz;
  c integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'window must be >= 1 second';
  end if;

  -- Snap to the start of the current window so concurrent callers share a row.
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.edge_rate_limits (bucket, window_start, count)
  values (p_bucket, w, 1)
  on conflict (bucket, window_start)
    do update set count = public.edge_rate_limits.count + 1
  returning count into c;

  -- Opportunistic cleanup. Cheap because it is keyed on the same bucket, and it
  -- keeps the table from accumulating dead windows without needing a cron job.
  delete from public.edge_rate_limits
   where bucket = p_bucket and window_start < w - make_interval(secs => p_window_seconds * 3);

  return c <= p_limit;   -- true = allowed
end;
$$;

revoke all on function public.gl_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.gl_rate_limit_hit(text, integer, integer) to service_role;

comment on function public.gl_rate_limit_hit(text, integer, integer) is
  'Fixed-window rate limiter for Edge Functions that call paid vendors. '
  'Returns true when the call is allowed. service_role only: these functions '
  'already require a staff session, so this bounds a compromised account '
  'rather than an anonymous one.';
