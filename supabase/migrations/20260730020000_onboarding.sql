-- Client onboarding: pipeline lead → client + token-gated self-service intake.
--
-- FLOW
--   1. Staff clicks "Convert to Client & Onboard" on a pipeline lead.
--   2. gl_onboarding_create() makes an onboarding row, prefilled from the deal,
--      with a long random token, and returns the token.
--   3. The client gets a link (onboard.html?token=…) and finishes the intake.
--   4. gl_onboarding_submit() writes their answers onto the client row and
--      flips status to 'submitted' — which fires notify-deal (WhatsApp/email).
--
-- SECURITY
--   The public page is anon and must NEVER touch this table directly (it holds
--   many clients' business details). All public access goes through two
--   SECURITY DEFINER RPCs that require the secret token and only ever read or
--   write the single row matching it — the same token-gated pattern used for
--   inspector links. Staff (is_staff_user) get normal RLS access for the
--   admin status view.

create extension if not exists pgcrypto;

create table if not exists public.onboarding (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete cascade,
  deal_id      uuid,
  token        text unique not null,
  status       text not null default 'invited',   -- invited | started | submitted | approved
  contact_email text,
  prefill      jsonb not null default '{}'::jsonb, -- what the lead already told us
  data         jsonb not null default '{}'::jsonb, -- what the client fills in
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  submitted_at timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists onboarding_client_idx on public.onboarding(client_id);
create index if not exists onboarding_status_idx on public.onboarding(status);

alter table public.onboarding enable row level security;

-- Staff-only direct access (admin status view). Anon reaches the row only
-- through the token RPCs below.
drop policy if exists "onboarding staff all" on public.onboarding;
create policy "onboarding staff all" on public.onboarding
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- ── Staff: create an onboarding for a client, prefilled, returns the token ──
create or replace function public.gl_onboarding_create(p_client_id uuid, p_prefill jsonb, p_deal_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_token text; v_email text; v_id uuid;
begin
  if not public.is_staff_user() then
    raise exception 'staff only';
  end if;
  if p_client_id is null then raise exception 'client_id required'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');   -- 48 hex chars
  v_email := nullif(trim(coalesce(p_prefill->>'email','')), '');
  insert into public.onboarding (client_id, deal_id, token, status, contact_email, prefill)
  values (p_client_id, p_deal_id, v_token, 'invited', v_email, coalesce(p_prefill, '{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end $$;

revoke all on function public.gl_onboarding_create(uuid, jsonb, uuid) from public, anon;
grant execute on function public.gl_onboarding_create(uuid, jsonb, uuid) to authenticated, service_role;

-- ── Public: read one onboarding by token (marks it 'started' on first open) ──
-- Returns only display-safe fields for that single row. No auth; the 48-char
-- token is the credential.
create or replace function public.gl_onboarding_get(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare r public.onboarding%rowtype; v_client_name text;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;
  select * into r from public.onboarding where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This onboarding link is not valid.');
  end if;
  if r.status = 'invited' then
    update public.onboarding set status = 'started', started_at = now(), updated_at = now()
    where id = r.id;
  end if;
  select name into v_client_name from public.clients where id = r.client_id;
  return jsonb_build_object(
    'ok', true,
    'status', r.status,
    'client_name', coalesce(v_client_name, r.prefill->>'company'),
    'prefill', r.prefill,
    'data', r.data,
    'submitted', (r.status = 'submitted' or r.status = 'approved')
  );
end $$;

revoke all on function public.gl_onboarding_get(text) from public;
grant execute on function public.gl_onboarding_get(text) to anon, authenticated, service_role;

-- ── Public: submit the completed intake by token ──
-- Writes the answers onto the linked client row (a curated allow-list of
-- columns — arbitrary keys can't be injected) and marks the row submitted.
create or replace function public.gl_onboarding_submit(p_token text, p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare r public.onboarding%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;
  select * into r from public.onboarding where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This onboarding link is not valid.');
  end if;
  if r.status in ('submitted','approved') then
    return jsonb_build_object('ok', false, 'error', 'This onboarding was already submitted. Contact us if you need to make changes.');
  end if;

  update public.onboarding
     set data = coalesce(p_data, '{}'::jsonb),
         status = 'submitted',
         submitted_at = now(),
         updated_at = now()
   where id = r.id;

  -- Copy the curated fields onto the client. jsonb ->> of a missing key is
  -- NULL, and coalesce keeps any existing value, so a blank answer never wipes
  -- data the lead already provided.
  if r.client_id is not null then
    update public.clients c set
      legal_name      = coalesce(nullif(p_data->>'legal_name',''),      c.legal_name),
      ein             = coalesce(nullif(p_data->>'ein',''),             c.ein),
      website         = coalesce(nullif(p_data->>'website',''),         c.website),
      contact_name    = coalesce(nullif(p_data->>'contact_name',''),    c.contact_name),
      phone           = coalesce(nullif(p_data->>'phone',''),           c.phone),
      street          = coalesce(nullif(p_data->>'street',''),          c.street),
      city            = coalesce(nullif(p_data->>'city',''),            c.city),
      state           = coalesce(nullif(p_data->>'state',''),           c.state),
      zip             = coalesce(nullif(p_data->>'zip',''),             c.zip),
      billing_street  = coalesce(nullif(p_data->>'billing_street',''),  c.billing_street),
      billing_city    = coalesce(nullif(p_data->>'billing_city',''),    c.billing_city),
      billing_state   = coalesce(nullif(p_data->>'billing_state',''),   c.billing_state),
      billing_zip     = coalesce(nullif(p_data->>'billing_zip',''),     c.billing_zip),
      shipping_street = coalesce(nullif(p_data->>'shipping_street',''), c.shipping_street),
      shipping_city   = coalesce(nullif(p_data->>'shipping_city',''),   c.shipping_city),
      shipping_state  = coalesce(nullif(p_data->>'shipping_state',''),  c.shipping_state),
      shipping_zip    = coalesce(nullif(p_data->>'shipping_zip',''),    c.shipping_zip),
      service         = coalesce(nullif(p_data->>'service',''),         c.service),
      notes           = coalesce(nullif(p_data->>'notes',''),           c.notes),
      onboarding_status = 'submitted',
      updated_at      = now()
    where c.id = r.client_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.gl_onboarding_submit(text, jsonb) from public;
grant execute on function public.gl_onboarding_submit(text, jsonb) to anon, authenticated, service_role;

-- Track onboarding state on the client itself (harmless if already present).
alter table public.clients add column if not exists onboarding_status text;

-- ── Notify staff when an onboarding is submitted ──
create or replace function public.trigger_notify_onboarding()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_secret text; v_name text;
begin
  if new.status = 'submitted' and coalesce(old.status,'') <> 'submitted' then
    begin
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
    exception when others then v_secret := ''; end;
    select name into v_name from public.clients where id = new.client_id;
    if v_secret is not null and v_secret <> '' then
      perform net.http_post(
        url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal',
        body := jsonb_build_object('event','onboarding_complete','secret',v_secret,
                 'data', jsonb_build_object('company', coalesce(v_name, new.prefill->>'company', 'A client'),
                                            'email', coalesce(new.contact_email,''))),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE')
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_onboarding_submit on public.onboarding;
create trigger on_onboarding_submit
  after update on public.onboarding
  for each row execute function public.trigger_notify_onboarding();

notify pgrst, 'reload schema';
