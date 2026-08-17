-- ════════════════════════════════════════════════════════════════
-- submit_quote_request — server-side input validation (audit finding #11)
-- ════════════════════════════════════════════════════════════════
-- submit_quote_request is the public quote endpoint: SECURITY DEFINER, granted
-- to anon, callable directly with the publishable key. The browser form in
-- index.html already validates required fields + email/phone format, but a
-- direct REST caller bypasses that entirely — it could inject half-empty or
-- malformed "leads" that pollute the pipeline and skew the auto deal-value
-- estimate. This mirrors the form's checks at the DB so the server, not the
-- client, is the source of truth.
--
-- Client-side rules mirrored here (index.html submitBooking/quote validation):
--   brand_name, contact_name, email, phone required; email must match the
--   form's regex; phone must have >= 10 digits; details >= 15 chars; at least
--   one service and one product_type. Plus hard length caps as belt-and-
--   suspenders alongside the existing left() truncation on insert.
--
-- Rate-limiting + dedupe/append behaviour from 20260812010000 is unchanged.
--
-- ROLLBACK: restore the function body from 20260812010000_quote_dedupe.sql.

create or replace function public.submit_quote_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid; v_brand text; v_email text; v_recent int; v_burst int;
  v_existing uuid; v_domain text; v_append text;
  v_contact text; v_phone text; v_details text;
begin
  -- ── Server-side validation (audit #11) ──────────────────────────
  -- brand_name stays the FIRST check (scripts/security-invariants.sh probes
  -- the endpoint with an empty payload and asserts this exact message).
  v_brand := nullif(btrim(coalesce(p->>'brand_name','')), '');
  if v_brand is null then raise exception 'brand_name is required'; end if;
  if length(v_brand) > 200 then raise exception 'brand_name is too long'; end if;

  v_contact := nullif(btrim(coalesce(p->>'contact_name','')), '');
  if v_contact is null then raise exception 'contact_name is required'; end if;
  if length(v_contact) > 200 then raise exception 'contact_name is too long'; end if;

  v_email := lower(nullif(btrim(coalesce(p->>'email','')), ''));
  if v_email is null then raise exception 'email is required'; end if;
  -- same shape the browser form enforces: something@something.tld
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

  -- ── Rate limiting (unchanged) ───────────────────────────────────
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

  -- ── Returning-lead dedupe / append (unchanged) ──────────────────
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

  return v_id;
end $$;

revoke all on function public.submit_quote_request(jsonb) from public;
grant execute on function public.submit_quote_request(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
