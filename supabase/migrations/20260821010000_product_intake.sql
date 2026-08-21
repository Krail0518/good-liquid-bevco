-- ════════════════════════════════════════════════════════════════
-- Product intake questionnaire store + public tour-gate RPC
-- ════════════════════════════════════════════════════════════════
-- One structured intake per prospect/client (the questionnaire defined in
-- intake-questions.js). Captured before a tour can be booked, editable by
-- staff in the CRM, and carried into the client record at onboarding. Keyed by
-- email so a prospect's pre-tour answers follow them into their client record.
--
-- Security (CLAUDE.md): staff full via is_gl_staff() (no USING(true)); portal
-- customers may read only their own client's row; the public tour path writes
-- exclusively through the SECURITY DEFINER RPC below (anon has no direct table
-- privilege). Contains formula / ingredient IP, so a RESTRICTIVE guard keeps
-- the warehouse role out, same as the formula vault.
--
-- ROLLBACK:
--   drop function if exists public.gl_tour_intake_submit(jsonb);
--   drop table if exists public.product_intake;

create table if not exists public.product_intake (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  deal_id      uuid references public.deals(id)   on delete set null,
  client_id    uuid references public.clients(id) on delete cascade,
  answers      jsonb       not null default '{}'::jsonb,
  source       text        not null default 'staff',   -- 'tour' | 'onboarding' | 'staff'
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        default auth.uid()
);
create index if not exists product_intake_email_idx  on public.product_intake (lower(email));
create index if not exists product_intake_client_idx on public.product_intake (client_id);
create index if not exists product_intake_deal_idx   on public.product_intake (deal_id);

alter table public.product_intake enable row level security;

drop policy if exists "gl staff manage product_intake" on public.product_intake;
create policy "gl staff manage product_intake"
  on public.product_intake as permissive for all to authenticated
  using (public.is_gl_staff()) with check (public.is_gl_staff());

drop policy if exists "portal reads own product_intake" on public.product_intake;
create policy "portal reads own product_intake"
  on public.product_intake as permissive for select to authenticated
  using (client_id = public.current_customer_client_id());

-- Warehouse (an active profiles row too) must not see client formula IP.
drop policy if exists "gl warehouse guard" on public.product_intake;
create policy "gl warehouse guard"
  on public.product_intake as restrictive for all to authenticated
  using (not public.gl_is_warehouse()) with check (not public.gl_is_warehouse());

grant select, insert, update, delete on public.product_intake to authenticated;

-- ── Public tour gate ────────────────────────────────────────────
-- Called by the public booking widget once the questionnaire is complete.
-- p = { "lead": <GL_INTAKE.leadPayload(answers)>, "answers": <full answers> }.
-- Reuses submit_quote_request (validation + rate-limit + returning-lead dedupe)
-- to create/attach the pipeline lead, then stores the structured intake keyed
-- by email so it can carry into the client record later.
create or replace function public.gl_tour_intake_submit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead    jsonb := coalesce(p->'lead', '{}'::jsonb);
  v_answers jsonb := coalesce(p->'answers', '{}'::jsonb);
  v_email   text  := lower(nullif(btrim(coalesce(v_lead->>'email','')), ''));
  v_deal    uuid;
  v_intake  uuid;
begin
  -- Create/attach the lead (raises on missing/invalid fields or rate limit).
  v_deal := public.submit_quote_request(v_lead);

  -- One intake per email — replace any prior answers for this address.
  if v_email is not null then
    update public.product_intake
       set answers = v_answers, deal_id = v_deal, source = 'tour', updated_at = now(), submitted_at = now()
     where lower(email) = v_email
     returning id into v_intake;
  end if;
  if v_intake is null then
    insert into public.product_intake (email, deal_id, answers, source)
    values (v_email, v_deal, v_answers, 'tour')
    returning id into v_intake;
  end if;

  return jsonb_build_object('deal_id', v_deal, 'intake_id', v_intake);
end $$;

revoke all on function public.gl_tour_intake_submit(jsonb) from public;
grant execute on function public.gl_tour_intake_submit(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
