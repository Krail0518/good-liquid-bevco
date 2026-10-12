-- ════════════════════════════════════════════════════════════════
-- Inbound alert gaps: one tour alert per request; quote alert shows volume
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK: re-run the two function definitions from
--   supabase/migrations/20260730001000_notify_trigger_auth.sql
--   (trigger_notify_new_quote and trigger_notify_tour_booked), then
--   alter function public.trigger_notify_new_quote()   set search_path = public, pg_temp;
--   alter function public.trigger_notify_tour_booked() set search_path = public, pg_temp;
-- Nothing else changes: no table, policy, grant or trigger binding.
--
-- 1. trigger_notify_tour_booked (bookings AFTER INSERT) alerted 'tour_booked'
--    ("TOUR BOOKED / New tour") for EVERY insert. Public requests from
--    book.html are inserted 'pending' by booking-confirm, which also sends its
--    own 'tour_requested' alert carrying the Approve/Decline link — so every
--    request alerted twice, and the guaranteed one was mislabelled as booked.
--    Now the trigger only alerts rows inserted already 'confirmed' (the column
--    default, i.e. a booking staff add directly). booking-confirm's
--    tour_requested is the single alert for a request, and is now awaited and
--    checked. Approval (booking-approve) is Mike's own action and sends the
--    customer their confirmation; it has never alerted Mike and still doesn't.
--    The trigger also sends the company now (bookings.booker_company).
--
-- 2. trigger_notify_new_quote never sent 'volume' (or the customer's
--    'message'), so the quote alert email always read "Volume: —". Both are
--    sent now; notify-deal's quoteRequestMessage shows them.
--
-- Rate limits (CLAUDE.md rule 7) are unchanged and still upstream of these
-- triggers: anon cannot insert contact_submissions directly
-- (20261012020000); submit_quote_request validates and throttles; and
-- booking-confirm limits bookings per email and site-wide.
--
-- Same auth shape as every notify trigger: the publishable (anon) key gets
-- past the functions gateway, the real authorization is the Vault-held
-- gl_notify_secret in the body, read at call time.

create or replace function public.trigger_notify_new_quote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'gl_notify_secret'
    limit 1;
  exception when others then
    v_secret := '';
  end;

  if v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal',
      body    := jsonb_build_object(
        'event',  'new_quote',
        'secret', v_secret,
        'data',   jsonb_build_object(
          'name',    coalesce(new.contact_name, ''),
          'company', coalesce(new.brand_name, ''),
          'email',   coalesce(new.email, ''),
          'phone',   coalesce(new.phone, ''),
          'service', coalesce(new.service, ''),
          'volume',  coalesce(new.volume, ''),
          'message', left(coalesce(new.message, ''), 2000)
        )
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE'
      )
    );
  end if;

  return new;
exception when others then
  return new;
end;
$$;

create or replace function public.trigger_notify_tour_booked()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  -- Public requests arrive 'pending' and alert from booking-confirm as
  -- 'tour_requested' (with the review link). Only a booking that is already
  -- confirmed when inserted is "booked".
  if coalesce(new.status, 'confirmed') <> 'confirmed' then
    return new;
  end if;

  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'gl_notify_secret'
    limit 1;
  exception when others then
    v_secret := '';
  end;

  if v_secret is not null and v_secret <> '' then
    perform net.http_post(
      url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal',
      body    := jsonb_build_object(
        'event',  'tour_booked',
        'secret', v_secret,
        'data',   jsonb_build_object(
          'name',    coalesce(new.booker_name, ''),
          'company', coalesce(new.booker_company, ''),
          'email',   coalesce(new.booker_email, ''),
          'date',    coalesce(to_char(new.start_at at time zone 'America/New_York', 'YYYY-MM-DD'), ''),
          'time',    coalesce(to_char(new.start_at at time zone 'America/New_York', 'HH24:MI'), '')
        )
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE'
      )
    );
  end if;

  return new;
exception when others then
  return new;
end;
$$;

-- Already true in production (only postgres and service_role hold EXECUTE);
-- restated so a replay from the repo ends in the same state.
revoke all on function public.trigger_notify_new_quote()   from public, anon, authenticated;
revoke all on function public.trigger_notify_tour_booked() from public, anon, authenticated;
