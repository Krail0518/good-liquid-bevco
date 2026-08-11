-- ── Auto-estimate a first-run deal value when a lead is created ───────────────
-- 2026-08-11
--
-- Every new lead should land in the pipeline already worth something, so Mike
-- isn't staring at a wall of $0 deals. On INSERT into public.deals, when no
-- value was supplied, this fires the estimate-deal-value edge function (async,
-- via pg_net) which reads the request text, has the AI pull out the few numbers
-- that drive price, and writes back a conservative first-run value computed from
-- Good Liquid's real per-can tiers. A value entered by hand is left untouched.
--
-- Mirrors the existing notify triggers (20260721_tour_alerts.sql): the shared
-- gl_notify_secret is read from Vault and sent in the body so the function can
-- authorize the call. pg_net is already enabled by that migration.
--
-- ROLLBACK:
--   drop trigger if exists on_deal_insert_estimate on public.deals;
--   drop function if exists public.trigger_estimate_deal_value();

create or replace function public.trigger_estimate_deal_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  -- Only estimate when the caller left the value unset, so a hand-entered
  -- figure (or a re-estimate) is never overwritten.
  if coalesce(NEW.value, 0) <> 0 then
    return NEW;
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
      url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/estimate-deal-value',
      body    := jsonb_build_object('deal_id', NEW.id, 'secret', v_secret),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  end if;

  return NEW;
exception when others then
  return NEW;  -- never block the insert on a notification failure
end $$;

drop trigger if exists on_deal_insert_estimate on public.deals;
create trigger on_deal_insert_estimate
  after insert on public.deals
  for each row
  execute function public.trigger_estimate_deal_value();
