-- ════════════════════════════════════════════════════════════════
-- Audit follow-ups: server-side numbering, last-login, token
-- lockdown, quote-spam throttle, invite hardening, search_path
-- ════════════════════════════════════════════════════════════════

-- ── 1. Portal last-login stamp ────────────────────────────────────
-- The portal used to fire `update customer_users set last_login…`
-- directly, which RLS silently rejected, so the CRM's "Last login"
-- column and "Signed in" KPI were permanently blank. A customer must
-- not be able to write that table directly, hence a definer function
-- scoped to the caller's own row.
create or replace function public.portal_touch_my_last_login()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.customer_users
     set last_login = now()
   where auth_user_id = auth.uid() and active = true;
$$;
revoke all on function public.portal_touch_my_last_login() from public;
grant execute on function public.portal_touch_my_last_login() to authenticated;

-- ── 2. Server-side quote numbers ──────────────────────────────────
-- quote_number was minted from a per-device localStorage counter while
-- the column carries a UNIQUE constraint, so a second device (or a
-- cleared browser) eventually collided and the save failed. Format is
-- unchanged: GLQ-<YYYYMM>-<NNN>, counter continuing across months.
do $$
declare v_max int;
begin
  select coalesce(max((regexp_replace(quote_number, '^.*-', ''))::int), 0)
    into v_max
    from public.quotes
   where quote_number ~ '^GLQ-[0-9]{6}-[0-9]+$';
  if to_regclass('public.gl_quote_seq') is null then
    execute format('create sequence public.gl_quote_seq start with %s', v_max + 1);
  end if;
end $$;

create or replace function public.gl_next_quote_number()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n bigint;
begin
  if not public.is_gl_staff() then
    raise exception 'staff only';
  end if;
  v_n := nextval('public.gl_quote_seq');
  return 'GLQ-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_n::text, 3, '0');
end $$;
revoke all on function public.gl_next_quote_number() from public;
grant execute on function public.gl_next_quote_number() to authenticated;
grant usage on sequence public.gl_quote_seq to authenticated;

-- ── 3. Inspector tokens: super-user only ──────────────────────────
-- These tokens grant ANONYMOUS read access to the compliance dataset,
-- so any staff account being able to mint one is a privilege gap.
drop policy if exists "inspector_tokens authed"     on public.inspector_tokens;
drop policy if exists "inspector_tokens authed all" on public.inspector_tokens;
drop policy if exists "inspector_tokens staff read" on public.inspector_tokens;
drop policy if exists "inspector_tokens super write" on public.inspector_tokens;
create policy "inspector_tokens staff read" on public.inspector_tokens
  for select to authenticated using (public.is_gl_staff());
create policy "inspector_tokens super write" on public.inspector_tokens
  for all to authenticated
  using (public.is_super_user()) with check (public.is_super_user());

-- ── 4. Throttle the public quote form ─────────────────────────────
-- Every submission fires a WhatsApp + email via the notify trigger, so
-- an unthrottled public endpoint is a way to flood the owner's phone.
-- Caps are deliberately well above real-world use.
create or replace function public.submit_quote_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; v_brand text; v_email text; v_recent int; v_burst int;
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

-- ── 5. Teammate invites cannot capture staff accounts ─────────────
-- A portal owner could attach ANY existing auth account to their own
-- client without that person's consent — including a Good Liquid staff
-- account, which would then show in the customer's teammate list.
create or replace function public.portal_invite_teammate(p_email text, p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email      text := lower(trim(p_email));
  v_caller     uuid := auth.uid();
  v_client_id  uuid;
  v_caller_row public.customer_users%rowtype;
  v_user_id    uuid;
  v_existing   uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  select * into v_caller_row
    from public.customer_users
    where auth_user_id = v_caller and active = true
    limit 1;
  if v_caller_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_portal_user');
  end if;
  if coalesce(v_caller_row.role, 'member') <> 'owner' then
    return jsonb_build_object('ok', false, 'error', 'only_owners_can_invite');
  end if;
  v_client_id := v_caller_row.client_id;
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    -- Never let a customer attach a Good Liquid staff account to their brand.
    if exists (select 1 from public.profiles pr
                where pr.id = v_user_id and coalesce(pr.status,'active') <> 'inactive') then
      return jsonb_build_object('ok', false, 'error', 'that_address_belongs_to_good_liquid_staff');
    end if;
    select id into v_existing from public.customer_users where auth_user_id = v_user_id limit 1;
    if v_existing is not null then
      update public.customer_users
         set client_id = v_client_id, email = v_email, active = true,
             display_name = coalesce(p_display_name, display_name)
       where id = v_existing and client_id = v_client_id;
      if found then
        return jsonb_build_object('ok', true, 'action', 'reactivated', 'auth_user_id', v_user_id);
      end if;
      return jsonb_build_object('ok', false, 'error', 'email_already_linked_to_another_brand');
    end if;
    insert into public.customer_users (auth_user_id, client_id, email, display_name, role, active, invited_by)
    values (v_user_id, v_client_id, v_email, p_display_name, 'member', true, v_caller);
    return jsonb_build_object('ok', true, 'action', 'linked', 'auth_user_id', v_user_id);
  end if;
  return jsonb_build_object('ok', false, 'error', 'auth_user_not_found', 'email', v_email);
end $$;

-- ── 6. Pin search_path on the remaining definer functions ─────────
-- A mutable search_path lets a caller with schema-create rights shadow
-- an unqualified reference inside the body.
alter function public.app_settings_updated_at()          set search_path = public, pg_temp;
alter function public.current_customer_client_id()       set search_path = public, pg_temp;
alter function public.deals_outreach_stamp()             set search_path = public, pg_temp;
alter function public.profiles_block_sensitive_updates() set search_path = public, pg_temp;
alter function public.trigger_notify_new_deal()          set search_path = public, pg_temp;
alter function public.trigger_notify_new_quote()         set search_path = public, pg_temp;
alter function public.trigger_notify_tour_booked()       set search_path = public, pg_temp;

notify pgrst, 'reload schema';
