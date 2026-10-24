-- ════════════════════════════════════════════════════════════════
-- Lead questionnaire link: a public, token gated web form per pipeline deal
-- ════════════════════════════════════════════════════════════════
-- Leads used to answer the PROJECT QUESTIONNAIRE by typing into an email.
-- This gives each pipeline deal a private link to questionnaire.html, which
-- renders the same GL_INTAKE form and saves straight into product_intake on
-- that deal. When the deal is converted (deals.client_id set by the CRM convert
-- flow or by an automated conversion), the intake row is stamped with the
-- client automatically, so the answers carry over to the active client.
--
-- Security (CLAUDE.md):
--   • deal_questionnaire_links: RLS on, staff only, anon has no table grant.
--   • Public access is only through SECURITY DEFINER RPCs gated by a 48 hex
--     char token; each RPC touches only the one deal the token maps to.
--   • gl_questionnaire_link (mint/read a token) is staff only, or a direct
--     postgres session (operator via MCP). PostgREST callers arrive as
--     'authenticator', so that branch is not reachable from the web.
--   • Rate limit on submit (rule 7): one submit per 20 seconds per token and at
--     most 25 per token; the staff alert fires at most once per hour per token.
--   • The returned prefill holds only what the lead already gave us.
--
-- ROLLBACK:
--   drop trigger if exists trg_deal_client_carries_intake on public.deals;
--   drop function if exists public.gl_deal_client_carries_intake();
--   drop function if exists public.gl_questionnaire_submit(text, jsonb);
--   drop function if exists public.gl_questionnaire_get(text);
--   drop function if exists public.gl_questionnaire_link(uuid);
--   drop table if exists public.deal_questionnaire_links;

create table if not exists public.deal_questionnaire_links (
  token          text primary key,
  deal_id        uuid not null unique references public.deals(id) on delete cascade,
  created_at     timestamptz not null default now(),
  opened_at      timestamptz,
  last_submit_at timestamptz,
  submit_count   integer not null default 0,
  notified_at    timestamptz
);

alter table public.deal_questionnaire_links enable row level security;
revoke all on public.deal_questionnaire_links from anon, public;

drop policy if exists "gl staff manage questionnaire links" on public.deal_questionnaire_links;
create policy "gl staff manage questionnaire links"
  on public.deal_questionnaire_links as permissive for all to authenticated
  using (public.is_gl_staff()) with check (public.is_gl_staff());

drop policy if exists "gl warehouse guard" on public.deal_questionnaire_links;
create policy "gl warehouse guard"
  on public.deal_questionnaire_links as restrictive for all to authenticated
  using (not public.gl_is_warehouse()) with check (not public.gl_is_warehouse());

grant select, insert, update, delete on public.deal_questionnaire_links to authenticated;

-- ── Staff / operator: get (or create) a deal's questionnaire token ──
create or replace function public.gl_questionnaire_link(p_deal_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_token text;
begin
  if not (public.is_gl_staff() or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_deal_id is null then raise exception 'deal id is required'; end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    raise exception 'deal not found';
  end if;

  select token into v_token from public.deal_questionnaire_links where deal_id = p_deal_id;
  if v_token is null then
    v_token := encode(gen_random_bytes(24), 'hex');
    insert into public.deal_questionnaire_links (token, deal_id) values (v_token, p_deal_id)
    on conflict (deal_id) do nothing;
    select token into v_token from public.deal_questionnaire_links where deal_id = p_deal_id;
  end if;
  return v_token;
end $$;

revoke all on function public.gl_questionnaire_link(uuid) from public, anon;
grant execute on function public.gl_questionnaire_link(uuid) to authenticated, service_role;

-- ── Public: load the form for a token ──
create or replace function public.gl_questionnaire_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare l public.deal_questionnaire_links; d public.deals; v jsonb;
begin
  if p_token is null or length(p_token) <> 48 then raise exception 'invalid link'; end if;
  select * into l from public.deal_questionnaire_links where token = p_token;
  if not found then raise exception 'invalid link'; end if;
  select * into d from public.deals where id = l.deal_id;
  if not found then raise exception 'invalid link'; end if;

  update public.deal_questionnaire_links set opened_at = coalesce(opened_at, now()) where token = p_token;

  select answers into v from public.product_intake
   where deal_id = d.id
      or (d.client_id is not null and client_id = d.client_id)
   order by updated_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'submitted', l.submit_count > 0,
    'company', coalesce(d.co, d.client_name, ''),
    'contact_name', coalesce(d.contact_name, ''),
    'email', coalesce(d.email, ''),
    'phone', coalesce(d.phone, ''),
    'answers', coalesce(v, '{}'::jsonb)
  );
end $$;

revoke all on function public.gl_questionnaire_get(text) from public;
grant execute on function public.gl_questionnaire_get(text) to anon, authenticated;

-- ── Public: save the answers for a token ──
create or replace function public.gl_questionnaire_submit(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l public.deal_questionnaire_links;
  d public.deals;
  v_id uuid;
  v_email text;
  v_secret text;
begin
  if p_token is null or length(p_token) <> 48 then raise exception 'invalid link'; end if;
  select * into l from public.deal_questionnaire_links where token = p_token for update;
  if not found then raise exception 'invalid link'; end if;

  if l.last_submit_at is not null and l.last_submit_at > now() - interval '20 seconds' then
    raise exception 'Please wait a moment before submitting again.';
  end if;
  if l.submit_count >= 25 then
    raise exception 'This link has reached its update limit. Reply to our email and we will help.';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'invalid answers'; end if;
  if length(p_answers::text) > 20000 then raise exception 'answers too long'; end if;

  select * into d from public.deals where id = l.deal_id;
  if not found then raise exception 'invalid link'; end if;
  v_email := lower(nullif(btrim(coalesce(p_answers->>'email', d.email, '')), ''));

  update public.product_intake
     set answers = p_answers, email = coalesce(v_email, email),
         client_id = coalesce(client_id, d.client_id),
         source = 'questionnaire', updated_at = now(), submitted_at = now()
   where deal_id = d.id
   returning id into v_id;

  if v_id is null and d.client_id is not null then
    update public.product_intake
       set answers = p_answers, email = coalesce(v_email, email), deal_id = d.id,
           source = 'questionnaire', updated_at = now(), submitted_at = now()
     where client_id = d.client_id
     returning id into v_id;
  end if;

  if v_id is null then
    insert into public.product_intake (email, deal_id, client_id, answers, source)
    values (v_email, d.id, d.client_id, p_answers, 'questionnaire')
    returning id into v_id;
  end if;

  -- Alert staff (Telegram/email via notify-deal), at most once an hour per link.
  if l.notified_at is null or l.notified_at < now() - interval '1 hour' then
    begin
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
    exception when others then v_secret := null; end;
    if coalesce(v_secret, '') <> '' then
      perform net.http_post(
        url := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal',
        body := jsonb_build_object('event', 'questionnaire_submitted', 'secret', v_secret,
                  'data', jsonb_build_object(
                    'company', left(coalesce(nullif(p_answers->>'company',''), d.co, 'A lead'), 120),
                    'email', left(coalesce(v_email, ''), 200),
                    'updated', case when l.submit_count > 0 then 'yes' else 'no' end)),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          -- The public anon JWT, as every other notify-deal trigger sends it; the
          -- real gate is the Vault secret in the body.
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE')
      );
      update public.deal_questionnaire_links set notified_at = now() where token = p_token;
    end if;
  end if;

  update public.deal_questionnaire_links
     set last_submit_at = now(), submit_count = submit_count + 1
   where token = p_token;

  return jsonb_build_object('ok', true, 'intake_id', v_id);
end $$;

revoke all on function public.gl_questionnaire_submit(text, jsonb) from public;
grant execute on function public.gl_questionnaire_submit(text, jsonb) to anon, authenticated;

-- ── Carry the intake over when a deal is converted to a client ──
create or replace function public.gl_deal_client_carries_intake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.client_id is not null and new.client_id is distinct from old.client_id then
    update public.product_intake
       set client_id = new.client_id, updated_at = now()
     where deal_id = new.id and client_id is null;
  end if;
  return new;
end $$;

revoke all on function public.gl_deal_client_carries_intake() from public, anon, authenticated;

drop trigger if exists trg_deal_client_carries_intake on public.deals;
create trigger trg_deal_client_carries_intake
  after update of client_id on public.deals
  for each row execute function public.gl_deal_client_carries_intake();

-- Backfill: deals already converted whose intake never got the client.
update public.product_intake pi
   set client_id = d.client_id
  from public.deals d
 where pi.deal_id = d.id and pi.client_id is null and d.client_id is not null;

notify pgrst, 'reload schema';
