-- Stripe settlement integrity — live behavioural proof (GL-119, GL-120).
--
-- Independent review 2026-09-17, R1 and R2. tests/stripe-webhook-behavior.test.cjs
-- proves what the webhook DECIDES for each Stripe event; this proves what the
-- DATABASE does with those decisions. Creates its own invoices, asserts, and
-- rolls everything back, so it can be run against production.
--
--   supabase db query --linked -f scripts/stripe-settlement-proof.sql
--
-- What this cannot show on its own: two refund events in two sessions at the
-- same moment. A single transaction has one session. That case is
-- scripts/stripe-refund-concurrency.sh, which holds the invoice lock in one
-- rolled-back session and times a second.

begin;

create temporary table proof(seq serial, assertion text, observed text, verdict text);

do $proof$
declare
  v    jsonb;
  net  numeric;
  st   text;
  procedure_ok boolean;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into public.invoices (invoice_number, client_name, service, amount, status) values
    ('PROOF-STRIPE-A', 'ZZ Portal QA (internal test)', 'proof', 100, 'pending'),
    ('PROOF-STRIPE-B', 'ZZ Portal QA (internal test)', 'proof', 100, 'pending'),
    ('PROOF-STRIPE-C', 'ZZ Portal QA (internal test)', 'proof', 100, 'pending');

  -- ---------------------------------------------- R1: one session, one payment
  v := public.gl_apply_payment_event('stripe', 'checkout_session:cs_proof_a', 'PROOF-STRIPE-A', 100, 'usd', 'card', 'cs_proof_a');
  insert into proof(assertion, observed, verdict) values
    ('a paid session settles the invoice once', v->>'reason' || ' / ' || coalesce(v->>'status',''),
     case when (v->>'applied')::boolean and v->>'status' = 'paid' then 'PASS' else 'FAIL' end);

  -- ACH: completed(unpaid) records nothing (webhook), then async_payment_succeeded
  -- and a redelivered completed(paid) both carry the same session key.
  v := public.gl_apply_payment_event('stripe', 'checkout_session:cs_proof_a', 'PROOF-STRIPE-A', 100, 'usd', 'us_bank_account', 'cs_proof_a');
  net := public.gl_ledger_net('PROOF-STRIPE-A');
  insert into proof(assertion, observed, verdict) values
    ('a second paid event for the same session is a duplicate, not a second payment',
     v->>'reason' || ', net ' || net, case when v->>'reason' = 'duplicate_event' and net = 100 then 'PASS' else 'FAIL' end);

  -- --------------------------------- R2: the reviewer's example, out of order
  -- $103 charge, $100 base. Cumulative refunds: $20.60, then $30.90. Answer: $30.
  -- Deliver the LATER cumulative figure first.
  v := public.gl_apply_stripe_refund('evt_proof_refund_2', 'PROOF-STRIPE-A', 'ch_proof_a', 10300, 3090, 10000);
  insert into proof(assertion, observed, verdict) values
    ('cumulative $30.90 of $103 reverses $30.00 of the $100 base', v->>'reason' || ' ' || coalesce(v->>'refunded_cents',''),
     case when (v->>'applied')::boolean and (v->>'refunded_cents')::int = 3000 then 'PASS' else 'FAIL' end);

  v := public.gl_apply_stripe_refund('evt_proof_refund_1', 'PROOF-STRIPE-A', 'ch_proof_a', 10300, 2060, 10000);
  net := public.gl_ledger_net('PROOF-STRIPE-A');
  insert into proof(assertion, observed, verdict) values
    ('the earlier $20.60 arriving late records nothing; total reversed stays $30 (never $50)',
     v->>'reason' || ', net ' || net, case when v->>'reason' = 'already_reflected' and net = 70 then 'PASS' else 'FAIL' end);

  v := public.gl_apply_stripe_refund('evt_proof_refund_2', 'PROOF-STRIPE-A', 'ch_proof_a', 10300, 3090, 10000);
  net := public.gl_ledger_net('PROOF-STRIPE-A');
  insert into proof(assertion, observed, verdict) values
    ('a redelivered refund event is a duplicate', v->>'reason' || ', net ' || net,
     case when v->>'reason' = 'duplicate_event' and net = 70 then 'PASS' else 'FAIL' end);

  -- ------------------------------------------------ R2: in order, same answer
  perform public.gl_apply_payment_event('stripe', 'checkout_session:cs_proof_b', 'PROOF-STRIPE-B', 100, 'usd', 'card', 'cs_proof_b');
  v := public.gl_apply_stripe_refund('evt_proof_b1', 'PROOF-STRIPE-B', 'ch_proof_b', 10300, 2060, 10000);
  insert into proof(assertion, observed, verdict) values
    ('in order: first cumulative $20.60 reverses $20.00', coalesce(v->>'refunded_cents', v->>'reason'),
     case when (v->>'refunded_cents')::int = 2000 then 'PASS' else 'FAIL' end);
  v := public.gl_apply_stripe_refund('evt_proof_b2', 'PROOF-STRIPE-B', 'ch_proof_b', 10300, 3090, 10000);
  net := public.gl_ledger_net('PROOF-STRIPE-B');
  insert into proof(assertion, observed, verdict) values
    ('in order: cumulative $30.90 reverses only the remaining $10.00; total $30', coalesce(v->>'refunded_cents', v->>'reason') || ', net ' || net,
     case when (v->>'refunded_cents')::int = 1000 and net = 70 then 'PASS' else 'FAIL' end);

  -- Full refund, including the surcharge, lands exactly on zero, never below.
  v := public.gl_apply_stripe_refund('evt_proof_b3', 'PROOF-STRIPE-B', 'ch_proof_b', 10300, 10300, 10000);
  net := public.gl_ledger_net('PROOF-STRIPE-B');
  select status into st from public.invoices where invoice_number = 'PROOF-STRIPE-B';
  insert into proof(assertion, observed, verdict) values
    ('a full refund reverses the rest of the base and nets to zero', coalesce(v->>'refunded_cents', v->>'reason') || ', net ' || net || ', status ' || st,
     case when (v->>'refunded_cents')::int = 7000 and net = 0 and st <> 'paid' then 'PASS' else 'FAIL' end);

  -- ------------------------------------------ R1: failed bank debit reversal
  v := public.gl_reverse_stripe_session('evt_proof_fail_c', 'PROOF-STRIPE-C', 'cs_proof_c');
  net := public.gl_ledger_net('PROOF-STRIPE-C');
  insert into proof(assertion, observed, verdict) values
    ('a failed debit with no recorded payment changes nothing', v->>'reason' || ', net ' || net,
     case when v->>'reason' = 'already_reflected' and net = 0 then 'PASS' else 'FAIL' end);

  -- An older deploy recorded the ACH early, keyed by event id with the session
  -- as reference. The failure must take it back.
  perform public.gl_apply_payment_event('stripe', 'evt_old_completed_unpaid', 'PROOF-STRIPE-C', 100, 'usd', 'us_bank_account', 'cs_proof_c');
  v := public.gl_reverse_stripe_session('evt_proof_fail_c2', 'PROOF-STRIPE-C', 'cs_proof_c');
  net := public.gl_ledger_net('PROOF-STRIPE-C');
  select status into st from public.invoices where invoice_number = 'PROOF-STRIPE-C';
  insert into proof(assertion, observed, verdict) values
    ('a failed debit reverses a payment recorded early; invoice is no longer paid', v->>'reason' || ', net ' || net || ', status ' || st,
     case when (v->>'applied')::boolean and net = 0 and st <> 'paid' then 'PASS' else 'FAIL' end);

  v := public.gl_reverse_stripe_session('evt_proof_fail_c2', 'PROOF-STRIPE-C', 'cs_proof_c');
  insert into proof(assertion, observed, verdict) values
    ('a redelivered failure event is a duplicate', v->>'reason',
     case when v->>'reason' = 'duplicate_event' then 'PASS' else 'FAIL' end);

  v := public.gl_reverse_stripe_session('evt_proof_fail_c3', 'PROOF-STRIPE-C', 'cs_proof_c');
  net := public.gl_ledger_net('PROOF-STRIPE-C');
  insert into proof(assertion, observed, verdict) values
    ('a second, different failure event cannot reverse twice', v->>'reason' || ', net ' || net,
     case when v->>'reason' = 'already_reflected' and net = 0 then 'PASS' else 'FAIL' end);

  -- ------------------------------------------------------------ privileges
  insert into proof(assertion, observed, verdict)
  select 'only service_role may execute ' || f,
         'anon=' || has_function_privilege('anon', f, 'execute') ||
         ' authenticated=' || has_function_privilege('authenticated', f, 'execute') ||
         ' service_role=' || has_function_privilege('service_role', f, 'execute'),
         case when not has_function_privilege('anon', f, 'execute')
               and not has_function_privilege('authenticated', f, 'execute')
               and has_function_privilege('service_role', f, 'execute') then 'PASS' else 'FAIL' end
    from unnest(array[
      'public.gl_apply_stripe_refund(text, text, text, bigint, bigint, bigint)',
      'public.gl_reverse_stripe_session(text, text, text)']) f;
end
$proof$;

select seq, verdict, assertion, observed from proof order by seq;

do $verdict$
declare bad int; total int;
begin
  select count(*) filter (where verdict <> 'PASS'), count(*) into bad, total from proof;
  if bad > 0 then
    raise exception '% of % stripe-settlement assertion(s) FAILED', bad, total;
  end if;
  raise notice 'stripe settlement: % of % assertions passed', total, total;
end
$verdict$;

-- Nothing is kept. Safe to run anywhere, including production.
rollback;
