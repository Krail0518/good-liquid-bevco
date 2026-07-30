-- Fix the notify-deal DB triggers: they sent a valid body secret but NO
-- Authorization header, so the functions gateway (verify_jwt) rejected every
-- call with 401 — trigger-driven WhatsApp alerts (new deal, public quote)
-- never arrived. Same class of silent failure as the cron outage; same fix:
-- carry the public anon key as the gateway pass, keep the real auth (the
-- Vault-held gl_notify_secret) in the body, read live at call time so a
-- rotation needs no trigger change.
--
-- Also adds the missing tour-booking trigger: the public booking form used to
-- send its alert from the BROWSER, using a secret embedded in the page HTML.
-- The bookings insert now fires the alert server-side, so the page needs no
-- secret at all (the frontend call + embedded secret are removed in the same
-- change set, and the Vault value is rotated by the follow-up migration).

create or replace function trigger_notify_new_deal()
returns trigger
language plpgsql
security definer
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
        'event',  'new_deal',
        'secret', v_secret,
        'data',   jsonb_build_object(
          'name',    coalesce(new.name, ''),
          'company', coalesce(new.client_name, ''),
          'stage',   coalesce(new.stage, 'Prospecting'),
          'service', coalesce(new.service, '')
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
  return new;  -- never block the insert
end;
$$;

create or replace function trigger_notify_new_quote()
returns trigger
language plpgsql
security definer
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
          'service', coalesce(new.service, '')
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

-- New: tour bookings fire their alert server-side (the public form only
-- inserts the row; no browser-held secret involved).
create or replace function trigger_notify_tour_booked()
returns trigger
language plpgsql
security definer
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
        'event',  'tour_booked',
        'secret', v_secret,
        'data',   jsonb_build_object(
          'name',  coalesce(new.booker_name, ''),
          'email', coalesce(new.booker_email, ''),
          'date',  coalesce(to_char(new.start_at at time zone 'America/New_York', 'YYYY-MM-DD'), ''),
          'time',  coalesce(to_char(new.start_at at time zone 'America/New_York', 'HH24:MI'), '')
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

drop trigger if exists on_booking_insert on bookings;
create trigger on_booking_insert
  after insert on bookings
  for each row
  execute function trigger_notify_tour_booked();
