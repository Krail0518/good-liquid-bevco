-- ════════════════════════════════════════════════════════════════
-- One alert per import, not one per deal
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop trigger if exists on_deals_insert_notify on public.deals;
--   drop function if exists public.trigger_notify_new_deals();
--   create trigger on_deal_insert after insert on public.deals
--     for each row execute function public.trigger_notify_new_deal();
--
-- on_deal_insert fired notify-deal once per row. On 2026-10-10 two imports
-- of 38 deals each, in one INSERT apiece, sent 76 WhatsApp alerts in two
-- minutes — enough to exhaust the free CallMeBot quota, and more than
-- Telegram will deliver to one chat in a burst.
--
-- The trigger is now per statement and sees the whole insert at once:
--   1-3 rows  → one 'new_deal' alert each, exactly as before
--   4+ rows   → a single 'deals_imported' summary (count + first names)
-- trigger_notify_new_deal() is left in place for the rollback above.
-- No permission changes: the function is SECURITY DEFINER like the one it
-- replaces, executable only by postgres and service_role.

create or replace function public.trigger_notify_new_deals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret  text;
  v_n       integer;
  v_names   text;
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

  if v_n <= 3 then
    for r in select * from new_rows loop
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object(
          'event',  'new_deal',
          'secret', v_secret,
          'data',   jsonb_build_object(
            'name',    coalesce(r.name, ''),
            'company', coalesce(r.client_name, ''),
            'stage',   coalesce(r.stage, 'Prospecting'),
            'service', coalesce(r.service, '')
          )
        ),
        headers := v_headers
      );
    end loop;
  else
    select string_agg(label, ', ') into v_names
      from (
        select coalesce(nullif(client_name, ''), nullif(name, ''), 'Unnamed') as label
          from new_rows
         order by created_at
         limit 5
      ) first_five;
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
        'event',  'deals_imported',
        'secret', v_secret,
        'data',   jsonb_build_object('count', v_n::text, 'names', coalesce(v_names, ''))
      ),
      headers := v_headers
    );
  end if;

  return null;
exception when others then
  return null;  -- never block the insert
end;
$$;

revoke all on function public.trigger_notify_new_deals() from public, anon, authenticated;
grant execute on function public.trigger_notify_new_deals() to service_role;

drop trigger if exists on_deal_insert on public.deals;
drop trigger if exists on_deals_insert_notify on public.deals;
create trigger on_deals_insert_notify
  after insert on public.deals
  referencing new table as new_rows
  for each statement
  execute function public.trigger_notify_new_deals();
