-- 1) Revoke anon SELECT where no anon policy justifies it.
-- 2) Stop the public tour questionnaire overwriting an existing client's intake.
--
-- ROLLBACK:
--   Section 1: re-grant only what a public flow actually needs, e.g.
--     grant select on public.<table> to anon;
--   Nothing here removes a grant that any anon policy relies on. If a public
--   page breaks, the correct fix is to add the missing anon policy AND the
--   grant together, not to restore the sweep.
--   Section 2: re-apply 20260821010000_product_intake.sql's version.
--
-- ── 1. anon SELECT grants with nothing behind them ──────────────────
--
-- PostgREST needs BOTH a table grant and a permitting RLS policy. 59 tables
-- carried an anon SELECT grant with no anon SELECT policy at all — among them
-- formulas (the client formula vault), profiles, customer_users, qbo_tokens,
-- invoice_payments, expenses, client_notes and lot_documents.
--
-- Those were inert: RLS denied, so anon read nothing. But "inert" here means
-- one stray permissive policy away from full exposure, with no second control
-- to catch it. That is precisely the 2026-05-18 incident, where policies
-- applied by hand in the dashboard turned latent grants into a live hole that
-- no migration described.
--
-- Revoking costs nothing observable — anon already could not read these — and
-- restores defence in depth: a future stray policy alone is no longer enough.
--
-- The list is computed rather than hardcoded so it cannot drift from reality
-- between writing and applying. Verified in a rolled-back transaction first:
-- 80 grants -> 21, revoking 59. The 21 kept are exactly those WITH an anon
-- policy — the FDA inspector-portal tables (audit_findings, audit_log,
-- cip_logs, compliance_records, defects, gmp_documents, gmp_task_defs,
-- gmp_templates, hold_tags, internal_audits, lot_inputs, lot_shipments,
-- management_reviews, mock_recalls, production_runs, training_records,
-- vendors) plus booking_pages, capacity, case_studies and resources.

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    select g.table_name
      from information_schema.role_table_grants g
     where g.grantee = 'anon'
       and g.table_schema = 'public'
       and g.privilege_type = 'SELECT'
       and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = g.table_name
            and p.roles::text like '%anon%'
            and p.cmd = 'SELECT')
  LOOP
    execute format('revoke select on public.%I from anon', r.table_name);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'revoked anon SELECT on % unbacked tables', n;
END $$;

-- ── 2. gl_tour_intake_submit must not overwrite a real client's intake ──
--
-- The UPDATE was scoped by email alone. product_intake holds formula and
-- ingredient answers, and gl_onboarding_intake_submit writes rows WITH
-- client_id set for real onboarded clients. The tour path is anon-callable, so
-- anyone who knew a client contact address could submit the public tour
-- questionnaire and destructively overwrite that client's stored answers,
-- flipping source to 'tour'.
--
-- `and client_id is null` means the tour path can only ever adopt a pre-client
-- prospect row. An intake already bound to a client is untouchable from the
-- public form.

create or replace function public.gl_tour_intake_submit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead    jsonb := coalesce(p->'lead', '{}'::jsonb);
  v_answers jsonb := coalesce(p->'answers', '{}'::jsonb);
  v_email   text  := lower(nullif(btrim(coalesce(v_lead->>'email','')), ''));
  v_deal    uuid;
  v_intake  uuid;
begin
  v_deal := public.submit_quote_request(v_lead);

  if v_email is not null then
    update public.product_intake
       set answers = v_answers, deal_id = v_deal, source = 'tour', updated_at = now(), submitted_at = now()
     where lower(email) = v_email
       and client_id is null
     returning id into v_intake;
  end if;
  if v_intake is null then
    insert into public.product_intake (email, deal_id, answers, source)
    values (v_email, v_deal, v_answers, 'tour')
    returning id into v_intake;
  end if;

  return jsonb_build_object('deal_id', v_deal, 'intake_id', v_intake);
end $function$;
