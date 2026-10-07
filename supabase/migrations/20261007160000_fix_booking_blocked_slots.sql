-- ════════════════════════════════════════════════════════════════
-- Public booking page: taken slots were never blocked
-- ════════════════════════════════════════════════════════════════
-- get_page_blocked_slots() filtered calendar events on ce.user_id, but
-- public.cal_events has no user_id column (it is the one shared Good Liquid
-- calendar). Every call failed with 42703 "column ce.user_id does not exist",
-- book.js treats a failed call as "nothing is taken", so the public page
-- /book offered every slot, including times already booked or blocked on
-- the calendar. Found in the 2026-10-07 smoke test.
--
-- Fix: block on every timed, non-production calendar event (shared calendar),
-- and only cast event_time values shaped like HH:MM so one odd value cannot
-- break the whole call again. Confirmed bookings logic is unchanged.
-- Signature, SECURITY DEFINER, search_path and grants are unchanged
-- (create or replace keeps the existing ACL; anon EXECUTE is intended,
-- see 20260807060000_function_execute_hardening.sql).
--
-- ROLLBACK: re-run the function body from
--   20260530000000_booking_blocked_slots.sql
-- (which restores the broken user_id filter).

create or replace function public.get_page_blocked_slots(p_page_id uuid)
returns table(start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz   text;
  v_dur  int;
begin
  select coalesce(timezone, 'America/New_York'), coalesce(duration, 30)
    into v_tz, v_dur
    from public.booking_pages
   where id = p_page_id and is_active = true;

  if not found then
    return;  -- unknown / inactive page: no blocked slots
  end if;

  -- 1. Confirmed bookings (UTC timestamptz)
  return query
    select b.start_at, b.end_at
      from public.bookings b
     where b.page_id = p_page_id
       and b.status  = 'confirmed'
       and b.start_at >= now();

  -- 2. Timed calendar events on the shared calendar (local time in v_tz).
  --    Production runs are canning days, not meetings, so they do not block.
  return query
    select ((ce.event_date::text || ' ' || ce.event_time)::timestamp at time zone v_tz) as start_at,
           ((ce.event_date::text || ' ' || ce.event_time)::timestamp at time zone v_tz
             + (v_dur * interval '1 minute')) as end_at
      from public.cal_events ce
     where ce.event_date is not null
       and ce.event_date >= current_date
       and ce.event_time ~ '^\s*([01]?[0-9]|2[0-3]):[0-5][0-9]\s*$'
       and coalesce(ce.event_type, '') not in ('production');
end;
$function$;
