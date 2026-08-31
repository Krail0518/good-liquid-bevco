-- Payment ledger — live behavioural proof.
--
-- SUPERSEDED IN PART, 31 August 2026. The external auditor found four defects
-- in the design this file was written against, and 20260831120000_payment_ledger_hardening.sql
-- fixed them. The assertions below still hold, but they are no longer the
-- whole story: the current run is scripts/payment-ledger-proof-v2.sql, which
-- adds the forgeable-guard, cumulative-overpayment, excess-refund and
-- derived-state cases. Kept because the 23/23 output it produced is cited in
-- the response of 31 August and should stay reproducible.

--
-- tests/payment-ledger.test.cjs proves the SOURCE says the right things. This
-- proves the DATABASE does the right things, which is the half a source scan
-- can never reach. Run it against any environment that has had
-- 20260831000000_payment_event_ledger.sql applied; it creates its own fixtures,
-- asserts, and rolls everything back, so it leaves no trace and can be run
-- against production.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/payment-ledger-proof.sql
--
-- Every line of output is an assertion with its observed value. A FAIL anywhere
-- aborts. This file is the evidence artifact the external audit asked for under
-- "Stripe replay/concurrency test output proving one ledger event and one
-- balance transition for duplicate and simultaneous webhooks".

\set ON_ERROR_STOP on
begin;

create temporary table proof(seq serial, assertion text, observed text, verdict text);

do $proof$
declare
  v      jsonb;
  n      int;
  total  numeric;
  st     text;
  note   text;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into public.invoices (invoice_number, client_name, service, amount, status)
  values ('PROOF-LEDGER-1', 'Proof Co', 'Co-packing', 1000, 'pending');

  -- ------------------------------------------------- 1. duplicate deliveries
  -- Stripe redelivers an event for up to three days. Three deliveries of one
  -- event must produce one ledger row and one balance transition.
  v := public.gl_apply_payment_event('stripe','proof_evt_1','PROOF-LEDGER-1',1000,'usd','card','cs_proof_1');
  insert into proof(assertion, observed, verdict) values
    ('first delivery applies', v::text, case when v->>'reason' = 'applied' then 'PASS' else 'FAIL' end);

  v := public.gl_apply_payment_event('stripe','proof_evt_1','PROOF-LEDGER-1',1000,'usd','card','cs_proof_1');
  insert into proof(assertion, observed, verdict) values
    ('second delivery is a duplicate', v::text, case when v->>'reason' = 'duplicate_event' then 'PASS' else 'FAIL' end);

  v := public.gl_apply_payment_event('stripe','proof_evt_1','PROOF-LEDGER-1',1000,'usd','card','cs_proof_1');
  insert into proof(assertion, observed, verdict) values
    ('third delivery is a duplicate', v::text, case when v->>'reason' = 'duplicate_event' then 'PASS' else 'FAIL' end);

  select count(*) into n from public.invoice_payments where provider='stripe' and provider_event_id='proof_evt_1';
  insert into proof(assertion, observed, verdict) values
    ('three deliveries produced ONE ledger row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  select status, paid_amount into st, total from public.invoices where invoice_number='PROOF-LEDGER-1';
  insert into proof(assertion, observed, verdict) values
    ('one balance transition: status=paid, paid_amount=1000', st || ' / ' || coalesce(total::text,'null'),
     case when st = 'paid' and total = 1000 then 'PASS' else 'FAIL' end);

  -- ------------------------------------------------- 2. simultaneous arrival
  -- The pre-flight SELECT catches the slow retry but not two deliveries in
  -- flight at once: both read no row and both proceed. The unique index is what
  -- settles that, so prove the index refuses the second insert outright.
  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, provider, provider_event_id, currency, event_kind)
    values ('PROOF-LEDGER-1', 1000, 'Stripe', current_date, 'stripe','proof_evt_1','usd','payment');
    insert into proof(assertion, observed, verdict) values
      ('the racing insert is refused by the unique index', 'accepted', 'FAIL');
  exception when unique_violation then
    insert into proof(assertion, observed, verdict) values
      ('the racing insert is refused by the unique index', 'rejected 23505', 'PASS');
  end;

  -- ------------------------------------------------------- 3. exactness
  v := public.gl_apply_payment_event('stripe','proof_evt_2','PROOF-LEDGER-1',5000,'usd','card','cs_proof_2');
  insert into proof(assertion, observed, verdict) values
    ('an amount larger than the invoice is refused', v::text,
     case when v->>'reason' = 'amount_exceeds_invoice' then 'PASS' else 'FAIL' end);

  v := public.gl_apply_payment_event('stripe','proof_evt_3','PROOF-LEDGER-1',10,'eur','card','cs_proof_3');
  insert into proof(assertion, observed, verdict) values
    ('a currency we do not settle is refused', v::text,
     case when v->>'reason' = 'unsupported_currency' then 'PASS' else 'FAIL' end);

  v := public.gl_apply_payment_event('stripe','proof_evt_4','NO-SUCH-INVOICE',10,'usd','card',null);
  insert into proof(assertion, observed, verdict) values
    ('an unknown invoice is refused', v::text,
     case when v->>'reason' = 'unknown_invoice' then 'PASS' else 'FAIL' end);

  -- -------------------------------------------------------- 4. the guard
  -- Nothing may assert paid state except the RPCs.
  --
  -- The mark-paid probe runs against a SECOND, still-unpaid invoice on purpose.
  -- Aimed at PROOF-LEDGER-1, which the RPC has already settled, the statement
  -- `set status='paid', paid_at=now()` changes nothing: status is already paid,
  -- and now() is transaction-start time, so paid_at is written back identical to
  -- itself. Postgres fires the trigger, the trigger correctly sees no change to
  -- paid state, and the UPDATE is allowed -- which reads as a hole in the guard
  -- and is really a no-op. The first version of this file asserted exactly that
  -- and reported a failure the database did not have.
  insert into public.invoices (invoice_number, client_name, service, amount, status)
  values ('PROOF-LEDGER-2', 'Proof Co', 'Bottling', 500, 'pending');

  begin
    update public.invoices set status='paid', paid_at=now() where invoice_number='PROOF-LEDGER-2';
    insert into proof(assertion, observed, verdict) values
      ('an unpaid invoice cannot be marked paid by UPDATE', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('an unpaid invoice cannot be marked paid by UPDATE', 'refused 42501', 'PASS');
  end;

  begin
    update public.invoices set paid_at = now() + interval '1 day' where invoice_number='PROOF-LEDGER-1';
    insert into proof(assertion, observed, verdict) values
      ('the paid date of a settled invoice cannot be moved', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('the paid date of a settled invoice cannot be moved', 'refused 42501', 'PASS');
  end;

  begin
    update public.invoices set paid_amount = 999999 where invoice_number='PROOF-LEDGER-1';
    insert into proof(assertion, observed, verdict) values
      ('the recorded amount cannot be inflated', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('the recorded amount cannot be inflated', 'refused 42501', 'PASS');
  end;

  begin
    update public.invoices set stripe_session_id='cs_forged' where invoice_number='PROOF-LEDGER-1';
    insert into proof(assertion, observed, verdict) values
      ('forging stripe_session_id is refused', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('forging stripe_session_id is refused', 'refused 42501', 'PASS');
  end;

  -- ...but an ordinary status change, which asserts nothing about money, is not
  -- blocked. A guard that stops the nightly overdue job is a broken guard.
  begin
    update public.invoices set notes='ordinary edit' where invoice_number='PROOF-LEDGER-1';
    insert into proof(assertion, observed, verdict) values
      ('an ordinary field edit is still allowed', 'allowed', 'PASS');
  exception when others then
    get stacked diagnostics note = message_text;
    insert into proof(assertion, observed, verdict) values
      ('an ordinary field edit is still allowed', 'BLOCKED: ' || note, 'FAIL');
  end;

  -- ---------------------------------------------------- 5. append-only ledger
  begin
    update public.invoice_payments set amount = 1 where invoice_number='PROOF-LEDGER-1';
    insert into proof(assertion, observed, verdict) values
      ('a ledger row cannot be edited', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('a ledger row cannot be edited', 'refused 42501', 'PASS');
  end;

  begin
    delete from public.invoice_payments where invoice_number='PROOF-LEDGER-1';
    insert into proof(assertion, observed, verdict) values
      ('a ledger row cannot be deleted', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('a ledger row cannot be deleted', 'refused 42501', 'PASS');
  end;

  -- ------------------------------------------------------------ 6. refunds
  v := public.gl_apply_refund_event('stripe','proof_ref_1','PROOF-LEDGER-1',400,'ch_proof_1');
  insert into proof(assertion, observed, verdict) values
    ('a partial refund is recorded as a reversal', v::text,
     case when v->>'reason' = 'refunded' then 'PASS' else 'FAIL' end);

  v := public.gl_apply_refund_event('stripe','proof_ref_1','PROOF-LEDGER-1',400,'ch_proof_1');
  insert into proof(assertion, observed, verdict) values
    ('a redelivered refund is a duplicate', v::text,
     case when v->>'reason' = 'duplicate_event' then 'PASS' else 'FAIL' end);

  select public.gl_invoice_paid_total('PROOF-LEDGER-1') into total;
  insert into proof(assertion, observed, verdict) values
    ('net paid after a 400 refund on 1000 is 600', total::text,
     case when total = 600 then 'PASS' else 'FAIL' end);

  select status into st from public.invoices where invoice_number='PROOF-LEDGER-1';
  insert into proof(assertion, observed, verdict) values
    ('a part-refunded invoice is no longer paid', st,
     case when st = 'pending' then 'PASS' else 'FAIL' end);

  select count(*) into n from public.invoice_payments where invoice_number='PROOF-LEDGER-1';
  insert into proof(assertion, observed, verdict) values
    ('both the payment and its reversal remain on the record', n::text,
     case when n = 2 then 'PASS' else 'FAIL' end);

  -- --------------------------------------------------- 7. staff-gated RPCs
  -- Run with no identity attached: is_gl_staff() is false, so both must refuse.
  begin
    perform public.gl_record_manual_payment('PROOF-LEDGER-1', 10, 'Cash', null);
    insert into proof(assertion, observed, verdict) values
      ('gl_record_manual_payment refuses a non-staff caller', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('gl_record_manual_payment refuses a non-staff caller', 'refused 42501', 'PASS');
  end;

  begin
    perform public.gl_reverse_invoice_payments('PROOF-LEDGER-1', 'x');
    insert into proof(assertion, observed, verdict) values
      ('gl_reverse_invoice_payments refuses a non-staff caller', 'allowed', 'FAIL');
  exception when insufficient_privilege then
    insert into proof(assertion, observed, verdict) values
      ('gl_reverse_invoice_payments refuses a non-staff caller', 'refused 42501', 'PASS');
  end;
end
$proof$;

select seq, verdict, assertion, observed from proof order by seq;

do $verdict$
declare bad int;
begin
  select count(*) into bad from proof where verdict <> 'PASS';
  if bad > 0 then
    raise exception '% payment-ledger assertion(s) FAILED', bad;
  end if;
  raise notice 'payment ledger: all assertions passed';
end
$verdict$;

-- Nothing is kept. Safe to run anywhere, including production.
rollback;
