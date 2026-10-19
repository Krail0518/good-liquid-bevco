-- ════════════════════════════════════════════════════════════════
-- Staff send: capabilities deck attached + project questionnaire
-- ════════════════════════════════════════════════════════════════
-- Asks the quote-decks edge function (template 'questionnaire') to email a
-- pipeline lead the project questionnaire with the deck PDF attached from the
-- sales-decks bucket. The function itself refuses anyone who already has a
-- product_intake row, and sends at most once per address per day.
--
-- Security (CLAUDE.md): SECURITY DEFINER, authorization first. Only GL staff
-- (is_staff_user) or a direct database session as postgres (the operator
-- running a batch from the Supabase SQL console / MCP) may call it. PostgREST
-- callers arrive as session_user 'authenticator', so the postgres branch is not
-- reachable from the web. The Vault secret never leaves the database.
--
-- ROLLBACK:
--   drop function if exists public.gl_send_deck_questionnaire(uuid, boolean, text);

create or replace function public.gl_send_deck_questionnaire(
  p_deal_id uuid, p_nudge boolean default false, p_first_name text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret  text;
  v_headers constant jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE'
  );
begin
  -- Authorization FIRST: before the Vault read, before any pg_net enqueue.
  if not (public.is_staff_user() or session_user = 'postgres') then
    raise exception 'Not authorized to send the questionnaire' using errcode = '42501';
  end if;
  if p_deal_id is null then raise exception 'deal id is required'; end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
  if coalesce(v_secret, '') = '' then raise exception 'gl_notify_secret is not set'; end if;

  return net.http_post(
    url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/quote-decks',
    body    := jsonb_build_object(
                 'deal_id', p_deal_id, 'secret', v_secret, 'template', 'questionnaire',
                 'nudge', coalesce(p_nudge, false),
                 'first_name', left(coalesce(p_first_name, ''), 60)),
    headers := v_headers,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function public.gl_send_deck_questionnaire(uuid, boolean, text) from public, anon;
grant execute on function public.gl_send_deck_questionnaire(uuid, boolean, text) to authenticated, service_role;
