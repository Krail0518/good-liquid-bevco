-- ════════════════════════════════════════════════════════════════
-- The public quote form: every submission has failed since 2026-08-28
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   Re-create submit_quote_request, gl_send_quote_decks and
--   trigger_notify_new_deals from 20260828231442_pricing_rls_and_quote_deck_authz.sql,
--   20260817010000_quote_request_validation.sql and
--   20261011190000_deal_import_alert_summary.sql respectively, then
--   drop function public.gl_dispatch_quote_decks(uuid);
--   (Rolling back re-breaks the public form — see below.)
--
-- 20260828231442 made gl_send_quote_decks staff-only (raise 42501 for anyone
-- else) so a stranger could not trigger deck emails for arbitrary deals. But
-- submit_quote_request — the anonymous website form — called it as its last
-- step, so for a real visitor it always raised and the whole RPC rolled back:
-- no deal, no alert. The page swallowed the error and showed "sent" because
-- Formspree had emailed. The last website deal created was 2026-08-27; ~60
-- submissions since reached Mike only as Formspree emails filtered out of his
-- inbox, and on Sep 30 Formspree's free monthly limit dropped 2 entirely.
-- The invariant probe only sent an empty payload, which validation rejects
-- before the deck call, so it passed throughout.
--
-- Also, the page's own contact_submissions insert sent six columns the
-- table does not have and never checked the error, so that table (and its
-- new_quote alert) has been empty since 2026-07-21.
--
-- Now:
--   * gl_dispatch_quote_decks(deal) does the deck dispatch with no caller
--     check; it is NOT executable by anon/authenticated, only from SECURITY
--     DEFINER code. gl_send_quote_decks keeps its staff-only check and calls it.
--   * submit_quote_request calls the dispatch for the deal it just made (or
--     appended to), and records the submission in contact_submissions in the
--     same transaction, which fires the new_quote alert with the contact's
--     details. A lead is never half-saved.
--   * The new_deal alert skips quote-request deals: the new_quote alert
--     already covers them, so one submission is one alert.
--   * p.dry_run = true runs the whole path and then rolls it back by raising
--     'DRY_RUN_OK'. The invariant probe uses it, so CI exercises the real
--     anonymous path daily without creating anything.
-- Permissions: unchanged for submit_quote_request (anon, authenticated);
-- the new gl_dispatch_quote_decks is service_role/postgres only.

create or replace function public.gl_dispatch_quote_decks(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  if p_deal_id is null then return; end if;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
  exception when others then
    v_secret := '';
  end;
  if coalesce(v_secret, '') = '' then return; end if;
  perform net.http_post(
    url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/quote-decks',
    body    := jsonb_build_object('deal_id', p_deal_id, 'secret', v_secret),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
exception when others then
  return;  -- best effort: a deck problem must never lose the lead
end;
$$;
revoke all on function public.gl_dispatch_quote_decks(uuid) from public, anon, authenticated;
grant execute on function public.gl_dispatch_quote_decks(uuid) to service_role;

create or replace function public.gl_send_quote_decks(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Authorization FIRST: before the Vault read, before any pg_net enqueue.
  if not public.is_staff_user() then
    raise exception 'Not authorized to send quote decks'
      using errcode = '42501';
  end if;
  perform public.gl_dispatch_quote_decks(p_deal_id);
end;
$$;

create or replace function public.submit_quote_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_brand text; v_email text; v_recent int; v_burst int;
  v_existing uuid; v_domain text; v_append text;
  v_contact text; v_phone text; v_details text;
  v_dry boolean := coalesce((p->>'dry_run')::boolean, false);
begin
  v_brand := nullif(btrim(coalesce(p->>'brand_name','')), '');
  if v_brand is null then raise exception 'brand_name is required'; end if;
  if length(v_brand) > 200 then raise exception 'brand_name is too long'; end if;

  v_contact := nullif(btrim(coalesce(p->>'contact_name','')), '');
  if v_contact is null then raise exception 'contact_name is required'; end if;
  if length(v_contact) > 200 then raise exception 'contact_name is too long'; end if;

  v_email := lower(nullif(btrim(coalesce(p->>'email','')), ''));
  if v_email is null then raise exception 'email is required'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'a valid email address is required';
  end if;
  if length(v_email) > 200 then raise exception 'email is too long'; end if;

  v_phone := nullif(btrim(coalesce(p->>'phone','')), '');
  if v_phone is null then raise exception 'phone is required'; end if;
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
    raise exception 'a valid phone number is required';
  end if;
  if length(v_phone) > 60 then raise exception 'phone is too long'; end if;

  v_details := coalesce(p->>'details','');
  if length(btrim(v_details)) < 15 then
    raise exception 'project details are required (at least 15 characters)';
  end if;
  if length(v_details) > 8000 then raise exception 'project details are too long'; end if;

  if nullif(btrim(coalesce(p->>'service','')), '') is null then
    raise exception 'service is required';
  end if;
  if nullif(btrim(coalesce(p->>'product_type','')), '') is null then
    raise exception 'product_type is required';
  end if;

  select count(*) into v_recent from public.deals
   where lower(email) = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 3 then
    raise exception 'We already have your request — Mike will be in touch shortly.';
  end if;

  select count(*) into v_burst from public.deals
   where created_at > now() - interval '10 minutes';
  if v_burst >= 15 then
    raise exception 'We are receiving a lot of requests right now — please try again in a few minutes.';
  end if;

  -- The raw submission, every time, in the same transaction as the deal. Its
  -- insert fires the new_quote alert (contact details included).
  insert into public.contact_submissions (brand_name, contact_name, email, phone, service, volume, message, status)
  values (left(v_brand, 200), left(v_contact, 200), left(v_email, 200), left(v_phone, 60),
          left(nullif(p->>'service',''), 200), left(nullif(p->>'volume',''), 120),
          left(
            v_details
            || case when coalesce(p->>'product_type','')  <> '' then chr(10) || 'Product: '       || (p->>'product_type')  else '' end
            || case when coalesce(p->>'city','') || coalesce(p->>'state','') <> '' then chr(10) || 'Location: ' || concat_ws(', ', nullif(p->>'city',''), nullif(p->>'state','')) else '' end
            || case when coalesce(p->>'timeline','')      <> '' then chr(10) || 'Timeline: '      || (p->>'timeline')      else '' end
            || case when coalesce(p->>'funding_stage','') <> '' then chr(10) || 'Funding stage: ' || (p->>'funding_stage') else '' end
            || case when coalesce(p->>'lead_source','')   <> '' then chr(10) || 'Lead source: '   || (p->>'lead_source')   else '' end,
            9000),
          'new');

  v_domain := lower(split_part(coalesce(v_email,''),'@',2));
  if v_domain in (
    'gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com',
    'live.com','msn.com','aol.com','icloud.com','me.com','mac.com','proton.me',
    'protonmail.com','gmx.com','zoho.com','mail.com','comcast.net','verizon.net',
    'att.net','sbcglobal.net'
  ) then
    v_domain := '';
  end if;

  select id into v_existing
    from public.deals
   where stage not in ('Closed Won','Closed Lost')
     and (
          (v_email is not null and lower(email) = v_email)
       or (lower(coalesce(client_name,'')) = lower(v_brand))
       or (v_domain <> '' and lower(coalesce(email,'')) like '%@' || v_domain)
     )
   order by created_at desc
   limit 1;

  if v_existing is not null then
    v_append := chr(10) || '--- New request ' || to_char(now(),'YYYY-MM-DD HH24:MI') || ' ---' || chr(10)
      || left(coalesce(p->>'details',''), 4000)
      || case when coalesce(p->>'product_type','') <> '' then chr(10) || 'Product: ' || (p->>'product_type') else '' end
      || case when coalesce(p->>'volume','')       <> '' then chr(10) || 'Volume: '  || (p->>'volume')       else '' end
      || case when coalesce(p->>'service','')       <> '' then chr(10) || 'Service: ' || (p->>'service')      else '' end;
    update public.deals
       set notes = left(coalesce(notes,'') || v_append, 20000)
     where id = v_existing;
    perform public.gl_dispatch_quote_decks(v_existing);
    v_id := v_existing;
  else
    insert into public.deals (
      name, client_name, value, stage, probability, notes,
      contact_name, email, phone, city, state,
      service, product_type, volume, timeline, funding_stage, lead_source
    ) values (
      left(v_brand, 200) || ' — Quote Request',
      left(v_brand, 200),
      0, 'Prospecting', 20,
      left(coalesce(p->>'details',''), 5000),
      left(v_contact, 200),
      left(v_email, 200),
      left(v_phone, 60),
      left(nullif(p->>'city',''), 120),
      left(nullif(p->>'state',''), 60),
      left(nullif(p->>'service',''), 200),
      left(nullif(p->>'product_type',''), 120),
      left(nullif(p->>'volume',''), 120),
      left(nullif(p->>'timeline',''), 120),
      left(nullif(p->>'funding_stage',''), 120),
      left(nullif(p->>'lead_source',''), 120)
    ) returning id into v_id;
    perform public.gl_dispatch_quote_decks(v_id);
  end if;

  -- The whole path ran; undo it. The exception rolls back the inserts and
  -- every queued pg_net request, so nothing is stored or sent.
  if v_dry then
    raise exception 'DRY_RUN_OK';
  end if;

  return v_id;
end $function$;

-- One submission, one alert: contact_submissions' new_quote alert covers a
-- quote-request deal, so the deals trigger leaves those out.
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

  select count(*) into v_n from new_rows where coalesce(name, '') not like '% — Quote Request';

  if v_n = 0 then
    return null;
  elsif v_n <= 3 then
    for r in select * from new_rows where coalesce(name, '') not like '% — Quote Request' loop
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
         where coalesce(name, '') not like '% — Quote Request'
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
