-- ============================================================
-- booking_blocked_slots — 2026-05-30
--
-- Adds a public RPC function get_page_blocked_slots(p_page_id)
-- that returns ALL blocked time windows for a booking page.
--
-- Sources combined:
--   1. bookings table  — confirmed appointments booked via the
--      public scheduling link (already UTC timestamptz).
--   2. cal_events table — manually added general calendar events
--      that have a specific time set. These are stored as a local
--      date (event_date DATE) + local time string (event_time TEXT,
--      format "HH:MM"). They are interpreted in the booking page's
--      configured timezone and each blocks one booking-duration
--      window.
--
-- The function runs as SECURITY DEFINER so the public booking
-- page (anon key) can read cal_events even though that table's
-- RLS only allows authenticated staff.
--
-- Idempotent — safe to re-run.
-- ============================================================

drop function if exists public.get_page_blocked_slots(uuid);

create or replace function public.get_page_blocked_slots(p_page_id uuid)
returns table(start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid;
  v_tz       text;
  v_dur      int;
begin
  -- Look up the booking page
  select user_id,
         coalesce(timezone, 'America/New_York'),
         coalesce(duration, 30)
  into   v_user_id, v_tz, v_dur
  from   public.booking_pages
  where  id        = p_page_id
    and  is_active = true;

  if not found then
    return;  -- unknown / inactive page → no blocked slots
  end if;

  -- ── 1. Confirmed bookings (stored as UTC timestamptz) ──────────────
  return query
    select b.start_at, b.end_at
    from   public.bookings b
    where  b.page_id = p_page_id
      and  b.status  = 'confirmed'
      and  b.start_at >= now();

  -- ── 2. Manual calendar events with a specific time set ─────────────
  --    event_date: DATE  (e.g. 2026-06-15)
  --    event_time: TEXT  (e.g. "09:00")   — local time in v_tz
  --    We skip production-type events (those are canning runs, not
  --    meetings that block the booking calendar).
  return query
    select
      -- Combine date + time string → local timestamp → UTC timestamptz
      ( (ce.event_date::text || ' ' || ce.event_time)::timestamp
        at time zone v_tz
      ) as start_at,
      ( (ce.event_date::text || ' ' || ce.event_time)::timestamp
        at time zone v_tz
        + (v_dur * interval '1 minute')
      ) as end_at
    from   public.cal_events ce
    where  ce.user_id    = v_user_id
      and  ce.event_time is not null
      and  ce.event_time <> ''
      and  ce.event_date is not null
      and  ce.event_date >= current_date
      and  ce.event_type not in ('production');
end;
$$;

-- Grant to both anon (public booking page) and authenticated (admin CRM)
grant execute on function public.get_page_blocked_slots(uuid) to anon;
grant execute on function public.get_page_blocked_slots(uuid) to authenticated;
