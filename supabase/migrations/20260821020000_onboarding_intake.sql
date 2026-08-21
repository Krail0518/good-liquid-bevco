-- ════════════════════════════════════════════════════════════════
-- Onboarding-page access to the product intake questionnaire
-- ════════════════════════════════════════════════════════════════
-- The token-gated onboarding page (onboard.html) shows the SAME product
-- questionnaire as the tour gate, pre-filled from whatever the prospect
-- already answered (carried over by client_id or email), and saves it back.
-- Two SECURITY DEFINER RPCs, gated by the 48-char onboarding token exactly
-- like gl_onboarding_get / gl_onboarding_submit — anon may call them but they
-- only ever touch the one row the token maps to.
--
-- ROLLBACK:
--   drop function if exists public.gl_onboarding_intake_get(text);
--   drop function if exists public.gl_onboarding_intake_submit(text, jsonb);

create or replace function public.gl_onboarding_intake_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r public.onboarding; v jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'invalid token'; end if;
  select * into r from public.onboarding where token = p_token;
  if not found then raise exception 'invalid token'; end if;

  select answers into v from public.product_intake
   where client_id = r.client_id
      or (r.contact_email is not null and lower(email) = lower(r.contact_email))
   order by updated_at desc
   limit 1;

  return jsonb_build_object('ok', true, 'answers', coalesce(v, '{}'::jsonb));
end $$;

create or replace function public.gl_onboarding_intake_submit(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.onboarding;
  v_answers jsonb := coalesce(p->'answers', p, '{}'::jsonb);
  v_email text;
  v_id uuid;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'invalid token'; end if;
  select * into r from public.onboarding where token = p_token;
  if not found then raise exception 'invalid token'; end if;
  if r.client_id is null then raise exception 'onboarding has no client'; end if;

  v_email := coalesce(nullif(v_answers->>'email',''), r.contact_email);

  -- Update this client's intake if one exists…
  update public.product_intake
     set answers = v_answers, email = v_email, deal_id = coalesce(deal_id, r.deal_id),
         source = 'onboarding', updated_at = now()
   where client_id = r.client_id
   returning id into v_id;

  -- …otherwise adopt the prospect's pre-client tour row by email…
  if v_id is null then
    update public.product_intake
       set client_id = r.client_id, answers = v_answers, deal_id = coalesce(deal_id, r.deal_id),
           source = 'onboarding', updated_at = now()
     where client_id is null and r.contact_email is not null and lower(email) = lower(r.contact_email)
     returning id into v_id;
  end if;

  -- …or create a fresh one.
  if v_id is null then
    insert into public.product_intake (email, client_id, deal_id, answers, source)
    values (v_email, r.client_id, r.deal_id, v_answers, 'onboarding')
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'intake_id', v_id);
end $$;

revoke all on function public.gl_onboarding_intake_get(text)          from public;
revoke all on function public.gl_onboarding_intake_submit(text, jsonb) from public;
grant execute on function public.gl_onboarding_intake_get(text)          to anon, authenticated;
grant execute on function public.gl_onboarding_intake_submit(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
