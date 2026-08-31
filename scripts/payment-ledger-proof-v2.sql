-- Payment ledger — live behavioural proof, v2.
--
-- 26 assertions covering the original design AND the four defects the external
-- auditor found in it on 31 August 2026:
--
--   2.1 CRITICAL  the guard trusted current_setting('gl.payment_apply'), which
--                 any SQL-capable caller can set. Reproduced before fixing: an
--                 invoice with ZERO ledger rows was driven to paid / 9999.
--   2.2 HIGH      each event was compared with the invoice total rather than the
--                 remaining balance, so two distinct 700s both passed on a 1000
--                 invoice and the ledger reached 1400.
--   2.3 HIGH      refunds were not capped at the refundable balance.
--   2.4 MED/HIGH  a partial refund nulled paid_amount, discarding a real
--                 partial balance.
--
-- Sections B, C and D below exist because of those four. Section A is the
-- original idempotency proof, retained.
--
-- Run against any environment that has both payment migrations applied. It
-- creates its own fixtures, asserts, and ROLLS BACK, so it leaves no trace and
-- is safe against production — which is where its published output came from.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/payment-ledger-proof-v2.sql
--
-- A FAIL anywhere aborts with a non-zero exit.

\set ON_ERROR_STOP on
begin;

create temporary table proof(seq serial, id text, assertion text, observed text, verdict text);

do $p$
declare v jsonb; n int; net numeric; st text; pa numeric;
begin
  insert into public.invoices (invoice_number, client_name, service, amount, status)
  values ('PRF-1','Proof','x',1000,'pending'), ('PRF-2','Proof','x',1000,'pending'),
         ('PRF-3','Proof','x',1000,'pending'), ('PRF-4','Proof','x',1000,'pending'),
         ('PRF-5','Proof','x',500,'pending');

  -- ── A. idempotency ───────────────────────────────────────────────────────
  v := public.gl_apply_payment_event('stripe','prf_e1','PRF-1',1000,'usd','card','cs_p1');
  insert into proof(id,assertion,observed,verdict) values ('A1','first delivery applies',v::text, case when v->>'reason'='applied' then 'PASS' else 'FAIL' end);
  v := public.gl_apply_payment_event('stripe','prf_e1','PRF-1',1000,'usd','card','cs_p1');
  insert into proof(id,assertion,observed,verdict) values ('A2','second delivery is a duplicate',v::text, case when v->>'reason'='duplicate_event' then 'PASS' else 'FAIL' end);
  v := public.gl_apply_payment_event('stripe','prf_e1','PRF-1',1000,'usd','card','cs_p1');
  insert into proof(id,assertion,observed,verdict) values ('A3','third delivery is a duplicate',v::text, case when v->>'reason'='duplicate_event' then 'PASS' else 'FAIL' end);
  select count(*) into n from public.invoice_payments where provider='stripe' and provider_event_id='prf_e1';
  insert into proof(id,assertion,observed,verdict) values ('A4','three deliveries produced ONE ledger row',n::text, case when n=1 then 'PASS' else 'FAIL' end);
  select status, paid_amount into st,pa from public.invoices where invoice_number='PRF-1';
  insert into proof(id,assertion,observed,verdict) values ('A5','one balance transition',st||' / '||coalesce(pa::text,'NULL'), case when st='paid' and pa=1000 then 'PASS' else 'FAIL' end);

  -- The racing insert, deliberately on an invoice WITH HEADROOM. Aimed at a
  -- fully-paid invoice the bounds check fires first, and the assertion then
  -- proves the wrong constraint. The first version of this file made exactly
  -- that mistake and reported a failure the database did not have.
  v := public.gl_apply_payment_event('stripe','prf_e8','PRF-5',100,'usd','card','cs_p8');
  begin
    insert into public.invoice_payments (invoice_number,amount,method,paid_at,provider,provider_event_id,currency,event_kind)
    values ('PRF-5',100,'Stripe',current_date,'stripe','prf_e8','usd','payment');
    insert into proof(id,assertion,observed,verdict) values ('A6','the racing insert is refused by the unique index','accepted','FAIL');
  exception when unique_violation then
    insert into proof(id,assertion,observed,verdict) values ('A6','the racing insert is refused by the unique index','rejected 23505','PASS');
  end;

  -- ── B. the guard is no longer forgeable  (auditor 2.1) ───────────────────
  begin
    perform set_config('gl.payment_apply','1',true);
    update public.invoices set status='paid', paid_at=now(), paid_amount=1000 where invoice_number='PRF-2';
    insert into proof(id,assertion,observed,verdict) values ('B1','set_config then a direct mark-paid','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('B1','set_config then a direct mark-paid','refused 42501','PASS');
  end;
  begin
    perform set_config('gl.payment_apply','1',true);
    update public.invoices set paid_amount=9999 where invoice_number='PRF-2';
    insert into proof(id,assertion,observed,verdict) values ('B2','forge paid_amount against an empty ledger','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('B2','forge paid_amount against an empty ledger','refused 42501','PASS');
  end;
  begin
    update public.invoices set stripe_session_id='cs_forged' where invoice_number='PRF-2';
    insert into proof(id,assertion,observed,verdict) values ('B3','forge a stripe_session_id','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('B3','forge a stripe_session_id','refused 42501','PASS');
  end;
  begin
    update public.invoices set notes='ordinary edit' where invoice_number='PRF-2';
    insert into proof(id,assertion,observed,verdict) values ('B4','an ordinary field edit is still allowed','allowed','PASS');
  exception when others then
    insert into proof(id,assertion,observed,verdict) values ('B4','an ordinary field edit is still allowed','BLOCKED','FAIL');
  end;

  -- ── C. cumulative overpayment  (auditor 2.2) ─────────────────────────────
  v := public.gl_apply_payment_event('stripe','prf_e2','PRF-3',700,'usd','card','cs_p2');
  insert into proof(id,assertion,observed,verdict) values ('C1','first 700 of 1000 applies',v::text, case when v->>'reason'='applied' then 'PASS' else 'FAIL' end);
  v := public.gl_apply_payment_event('stripe','prf_e3','PRF-3',700,'usd','card','cs_p3');
  insert into proof(id,assertion,observed,verdict) values ('C2','a second DISTINCT 700 is rejected',v::text, case when v->>'reason'='exceeds_balance' then 'PASS' else 'FAIL' end);
  select count(*) into n from public.invoice_payments where invoice_number='PRF-3';
  insert into proof(id,assertion,observed,verdict) values ('C3','no extra ledger row',n::text, case when n=1 then 'PASS' else 'FAIL' end);
  v := public.gl_apply_payment_event('stripe','prf_e4','PRF-3',300,'usd','card','cs_p4');
  insert into proof(id,assertion,observed,verdict) values ('C4','a 300 that exactly fits is accepted',v::text, case when v->>'reason'='applied' then 'PASS' else 'FAIL' end);
  -- The bound lives in a trigger, so it holds for a direct INSERT too. In the
  -- RPCs alone it would hold only for callers who use the RPCs.
  begin
    insert into public.invoice_payments (invoice_number,amount,method,paid_at,provider,provider_event_id,currency,event_kind)
    values ('PRF-3',50,'Other',current_date,null,null,'usd','payment');
    insert into proof(id,assertion,observed,verdict) values ('C5','a direct INSERT over the balance is refused too','accepted','FAIL');
  exception when check_violation then
    insert into proof(id,assertion,observed,verdict) values ('C5','a direct INSERT over the balance is refused too','rejected 23514','PASS');
  end;

  -- ── D. refunds and derived state  (auditor 2.3, 2.4) ─────────────────────
  v := public.gl_apply_payment_event('stripe','prf_e5','PRF-4',1000,'usd','card','cs_p5');
  v := public.gl_apply_refund_event('stripe','prf_r1','PRF-4',1500,'ch_p1');
  insert into proof(id,assertion,observed,verdict) values ('D1','a refund over the refundable balance is rejected',v::text, case when v->>'reason'='exceeds_refundable' then 'PASS' else 'FAIL' end);
  v := public.gl_apply_refund_event('stripe','prf_r2','PRF-4',400,'ch_p2');
  insert into proof(id,assertion,observed,verdict) values ('D2','a partial refund is recorded',v::text, case when v->>'reason'='refunded' then 'PASS' else 'FAIL' end);
  select status, paid_amount into st,pa from public.invoices where invoice_number='PRF-4';
  select coalesce(sum(amount),0) into net from public.invoice_payments where invoice_number='PRF-4';
  insert into proof(id,assertion,observed,verdict) values ('D3','paid_amount equals the net, not NULL','status='||st||' paid_amount='||coalesce(pa::text,'NULL')||' net='||net::text, case when pa=net and net=600 and st='pending' then 'PASS' else 'FAIL' end);
  v := public.gl_apply_refund_event('stripe','prf_r2','PRF-4',400,'ch_p2');
  insert into proof(id,assertion,observed,verdict) values ('D4','a redelivered refund is still a duplicate',v::text, case when v->>'reason'='duplicate_event' then 'PASS' else 'FAIL' end);
  select coalesce(sum(amount),0) into net from public.invoice_payments where invoice_number='PRF-4';
  insert into proof(id,assertion,observed,verdict) values ('D5','the ledger never went negative',net::text, case when net>=0 then 'PASS' else 'FAIL' end);

  -- ── E. append-only ───────────────────────────────────────────────────────
  begin
    update public.invoice_payments set amount=1 where invoice_number='PRF-1';
    insert into proof(id,assertion,observed,verdict) values ('E1','a ledger row cannot be edited','allowed','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('E1','a ledger row cannot be edited','refused 42501','PASS');
  end;
  begin
    delete from public.invoice_payments where invoice_number='PRF-1';
    insert into proof(id,assertion,observed,verdict) values ('E2','a ledger row cannot be deleted','allowed','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('E2','a ledger row cannot be deleted','refused 42501','PASS');
  end;

  -- ── F. the staff gate ────────────────────────────────────────────────────
  begin
    perform public.gl_record_manual_payment('PRF-5',10,'Cash',null);
    insert into proof(id,assertion,observed,verdict) values ('F1','manual payment refuses a non-staff caller','allowed','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('F1','manual payment refuses a non-staff caller','refused 42501','PASS');
  end;
  begin
    perform public.gl_reverse_invoice_payments('PRF-1','x');
    insert into proof(id,assertion,observed,verdict) values ('F2','reversal refuses a non-staff caller','allowed','FAIL');
  exception when insufficient_privilege then
    insert into proof(id,assertion,observed,verdict) values ('F2','reversal refuses a non-staff caller','refused 42501','PASS');
  end;

  -- ── G. exactness ─────────────────────────────────────────────────────────
  v := public.gl_apply_payment_event('stripe','prf_e6','PRF-5',10,'eur','card',null);
  insert into proof(id,assertion,observed,verdict) values ('G1','a currency we do not settle is refused',v::text, case when v->>'reason'='unsupported_currency' then 'PASS' else 'FAIL' end);
  v := public.gl_apply_payment_event('stripe','prf_e7','NO-SUCH',10,'usd','card',null);
  insert into proof(id,assertion,observed,verdict) values ('G2','an unknown invoice is refused',v::text, case when v->>'reason'='unknown_invoice' then 'PASS' else 'FAIL' end);
end
$p$;

select seq, id, verdict, assertion, observed from proof order by seq;

do $verdict$
declare bad int;
begin
  select count(*) into bad from proof where verdict <> 'PASS';
  if bad > 0 then
    raise exception '% payment-ledger assertion(s) FAILED', bad;
  end if;
  raise notice 'payment ledger v2: all assertions passed';
end
$verdict$;

-- NOT COVERED HERE, and stated rather than implied: genuine wall-clock
-- concurrency between two live connections. dblink in this project requires a
-- password, which this process will not handle, so the two-connection case in
-- the auditor's section 4.3 has not been demonstrated. What IS demonstrated is
-- the mechanism that settles it — the bounds trigger takes `for update` on the
-- invoice before summing, so a second inserter blocks and then re-reads the
-- committed total under READ COMMITTED, and the unique index refuses a repeated
-- provider event outright. To run the two-connection case: open two psql
-- sessions, BEGIN in both, insert the same event id in each, and commit.

rollback;
