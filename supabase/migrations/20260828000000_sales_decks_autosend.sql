-- ════════════════════════════════════════════════════════════════
-- sales_decks — the decks every quote request gets, sent automatically
-- ════════════════════════════════════════════════════════════════
-- Mike's standing instruction: when somebody submits the public quote form,
-- they should immediately receive the Good Liquid capabilities/pricing deck
-- AND the Lotus Nutra R&D pricing deck, without him touching anything.
--
-- WHERE THE FILES LIVE, AND WHY
-- The Lotus deck is stamped "Confidential Proposal" on every page and carries
-- a partner's internal credit pricing and IP buyout figures. Putting it in the
-- repo would publish it on goodliquidbevco.com — anything under the site root
-- is served by Vercel to anyone who guesses (or is handed) the URL. So the PDFs
-- live in a PRIVATE storage bucket instead, and the edge function reads them
-- with the service role and attaches them to the mail. No public URL exists,
-- and nothing about the deck is reachable with the publishable key.
--
-- The bucket is staff-only: the same `is_gl_staff()` scoping 20260807030000
-- applied to client-docs, not the legacy "any authenticated user" policy that
-- audit found. A portal customer must not be able to list our partner pricing.
--
-- WHICH DECKS GO OUT is a data question, not a code question — the sales_decks
-- table drives it, so Mike can replace a deck or stop sending one from the CRM
-- (📎 SALES DECKS, crm-sales-decks.js) without a deploy.
--
-- DELIVERY PATH
--   submit_quote_request (public RPC, anon)
--     └→ gl_send_quote_decks(deal_id)   — reads gl_notify_secret from Vault
--         └→ pg_net POST /functions/v1/quote-decks {deal_id, secret}
--             └→ loads the deal, attaches every active deck, sends via Mailgun,
--                logs to email_log (template_name = 'quote_decks')
-- The send is fired server-side from the RPC rather than from the browser, so
-- it happens even if the visitor closes the tab the moment they hit submit, and
-- so the recipient address is always the one we stored — a caller cannot post
-- an arbitrary address and have our decks mailed to it. Mirrors the pg_net +
-- Vault-secret pattern of trigger_estimate_deal_value (20260811030000).
--
-- Rate limiting: inherited from submit_quote_request itself (max 3 requests per
-- email per hour, 15 site-wide per 10 minutes — 20260812010000), plus a
-- 90-day "already sent to this address" check inside the function, so a
-- returning lead is not mailed the same two PDFs again.
--
-- ROLLBACK:
--   restore submit_quote_request from 20260817010000_quote_request_validation.sql;
--   drop function if exists public.gl_send_quote_decks(uuid);
--   drop table if exists public.sales_decks;
--   drop policy if exists "sales-decks staff all" on storage.objects;
--   delete from storage.buckets where id = 'sales-decks';   -- only if empty

-- ── 1. Private bucket for the PDFs ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('sales-decks', 'sales-decks', false)
on conflict (id) do nothing;

-- Staff only, both directions. No anon, no portal customer, no viewer-tier
-- carve-out needed: reading a deck is harmless for staff, and the edge function
-- uses the service role, which bypasses RLS entirely.
drop policy if exists "sales-decks staff all" on storage.objects;
create policy "sales-decks staff all" on storage.objects
  for all to authenticated
  using      (bucket_id = 'sales-decks' and public.is_gl_staff())
  with check (bucket_id = 'sales-decks' and public.is_gl_staff());

-- ── 2. Which decks auto-send ────────────────────────────────────────────────
create table if not exists public.sales_decks (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,   -- stable machine key
  label         text not null,          -- shown in the CRM
  filename      text not null,          -- what the recipient sees attached
  storage_path  text,                   -- object name inside the sales-decks bucket
  active        boolean not null default true,
  sort_order    int not null default 0,
  size_bytes    bigint,
  uploaded_at   timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.sales_decks enable row level security;

drop policy if exists "sales_decks staff read"   on public.sales_decks;
drop policy if exists "sales_decks staff insert" on public.sales_decks;
drop policy if exists "sales_decks staff update" on public.sales_decks;
create policy "sales_decks staff read" on public.sales_decks
  for select to authenticated using (public.is_gl_staff());
create policy "sales_decks staff insert" on public.sales_decks
  for insert to authenticated
  with check (public.is_gl_staff() and not public.gl_is_viewer());
create policy "sales_decks staff update" on public.sales_decks
  for update to authenticated
  using      (public.is_gl_staff() and not public.gl_is_viewer())
  with check (public.is_gl_staff() and not public.gl_is_viewer());

grant select, insert, update on public.sales_decks to authenticated;

-- Seeded with storage_path NULL: the row says "this deck should go out", the
-- upload in the CRM fills in the file. The function skips a deck with no file
-- and never sends an email with nothing attached, so a half-set-up state
-- cannot mail a prospect an empty "here are our decks".
insert into public.sales_decks (key, label, filename, sort_order) values
  ('good_liquid_capabilities', 'Good Liquid capabilities & pricing deck',
   'Good Liquid Bev Co - Capabilities and Pricing.pdf', 10),
  ('lotus_nutra_pricing',      'Lotus Nutra R&D pricing (confidential)',
   'Lotus Nutra - R&D Pricing.pdf', 20)
on conflict (key) do nothing;

-- ── 3. Fire the send ────────────────────────────────────────────────────────
create or replace function public.gl_send_quote_decks(p_deal_id uuid)
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
      from vault.decrypted_secrets
     where name = 'gl_notify_secret'
     limit 1;
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
  return;  -- a failed deck send must never cost us the lead
end $$;

revoke all on function public.gl_send_quote_decks(uuid) from public, anon;
grant execute on function public.gl_send_quote_decks(uuid) to service_role;

-- ── 4. Call it from the public quote endpoint ───────────────────────────────
-- Body is 20260817010000 unchanged except for the two gl_send_quote_decks
-- calls; the validation, rate limiting and dedupe/append rules are identical.
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
    -- A returning lead gets the decks too — the function's own 90-day check
    -- decides whether they have already had them.
    perform public.gl_send_quote_decks(v_existing);
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

  perform public.gl_send_quote_decks(v_id);

  return v_id;
end $$;

revoke all on function public.submit_quote_request(jsonb) from public;
grant execute on function public.submit_quote_request(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
