-- ── Returning-lead de-duplication on public quote submissions ─────────────────
-- 2026-08-12
--
-- A prospect who already has an OPEN deal often submits the form again (new
-- idea, or they forgot they'd reached out) — sometimes from a second address at
-- the same company. That used to spawn a duplicate deal and split their history.
-- submit_quote_request now looks for an existing open deal by the same email,
-- the same company name, or the same (non-free) company domain, and when it
-- finds one it APPENDS the new request to that deal's notes and returns the
-- existing id instead of inserting a duplicate.
--
-- The "new quote" WhatsApp/email still fires — it's driven by the separate
-- contact_submissions insert, not this function — so Mike is still notified that
-- a (returning) lead came in.
--
-- Rate limits are unchanged.
--
-- ROLLBACK: restore the prior body from 20260807040000_audit_followups.sql.

create or replace function public.submit_quote_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid; v_brand text; v_email text; v_recent int; v_burst int;
  v_existing uuid; v_domain text; v_append text;
begin
  v_brand := nullif(btrim(coalesce(p->>'brand_name','')), '');
  if v_brand is null then raise exception 'brand_name is required'; end if;
  v_email := lower(nullif(btrim(coalesce(p->>'email','')), ''));

  -- Per-submitter: 3 quote requests per hour.
  if v_email is not null then
    select count(*) into v_recent from public.deals
     where lower(email) = v_email and created_at > now() - interval '1 hour';
    if v_recent >= 3 then
      raise exception 'We already have your request — Mike will be in touch shortly.';
    end if;
  end if;

  -- Global burst guard: 15 submissions in 10 minutes across the site.
  select count(*) into v_burst from public.deals
   where created_at > now() - interval '10 minutes';
  if v_burst >= 15 then
    raise exception 'We are receiving a lot of requests right now — please try again in a few minutes.';
  end if;

  -- ── De-dup: is there already an OPEN deal for this person or company? ──
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
    return v_existing;
  end if;

  -- ── Otherwise, create the new lead (unchanged shape) ──
  insert into public.deals (
    name, client_name, value, stage, probability, notes,
    contact_name, email, phone, city, state,
    service, product_type, volume, timeline, funding_stage, lead_source
  ) values (
    left(v_brand, 200) || ' — Quote Request',
    left(v_brand, 200),
    0, 'Prospecting', 20,
    left(coalesce(p->>'details',''), 5000),
    left(nullif(p->>'contact_name',''), 200),
    left(v_email, 200),
    left(nullif(p->>'phone',''), 60),
    left(nullif(p->>'city',''), 120),
    left(nullif(p->>'state',''), 60),
    left(nullif(p->>'service',''), 200),
    left(nullif(p->>'product_type',''), 120),
    left(nullif(p->>'volume',''), 120),
    left(nullif(p->>'timeline',''), 120),
    left(nullif(p->>'funding_stage',''), 120),
    left(nullif(p->>'lead_source',''), 120)
  ) returning id into v_id;

  return v_id;
end $$;

revoke all on function public.submit_quote_request(jsonb) from public;
grant execute on function public.submit_quote_request(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
