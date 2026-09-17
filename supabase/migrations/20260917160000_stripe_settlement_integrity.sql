-- ════════════════════════════════════════════════════════════════
-- Stripe settlement integrity (GL-119, GL-120)
-- Independent review 2026-09-17, findings R1 and R2.
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop function if exists public.gl_apply_stripe_refund(text, text, text, bigint, bigint, bigint);
--   drop function if exists public.gl_reverse_stripe_session(text, text, text);
--   notify pgrst, 'reload schema';
--   (and redeploy the previous stripe-webhook, which does not call them)
--   Nothing here alters a table, so rollback loses no data.
--
-- R2 — WHAT WAS WRONG. charge.refunded reports amount_refunded CUMULATIVELY.
-- stripe-webhook read the charge's prior reversals over one HTTP request,
-- subtracted, and posted the difference to gl_apply_refund_event in another.
-- Nothing held a lock between the read and the write, and the refund RPC takes
-- a caller-computed amount, deduplicating only by event id. Two refund events
-- for one charge processed at the same moment both read "0 so far": for a
-- $103 charge on a $100 invoice with cumulative refunds of $20.60 then $30.90,
-- the ledger reversed $20 + $30 = $50 instead of $30. The bounds trigger does
-- not catch it — $50 is inside a $100 paid balance.
--
-- THE FIX. The subtraction moves into the database, after the invoice row is
-- locked. gl_enforce_ledger_bounds already takes that same lock, so every
-- ledger write for an invoice serialises on it; a second refund event waits,
-- then (READ COMMITTED: each statement takes a fresh snapshot) reads the first
-- one's committed reversal and reverses only what is left. Out of order is safe
-- for the same reason: an older, smaller cumulative figure arriving late
-- computes a negative delta and records nothing.
--
-- R1 — WHAT WAS WRONG is fixed in the webhook (settle only on payment_status =
-- 'paid'). This file adds the one database piece it needs: when a bank debit
-- FAILS, reverse any payment recorded for that session, under the same lock.
-- Today there is none to reverse — the ledger has never held a Stripe row — so
-- this is defence for a payment an older deploy may have recorded early.
--
-- Both functions: SECURITY DEFINER, search_path pinned to pg_catalog/pg_temp
-- with every reference schema-qualified, and executable by service_role only
-- (the webhook). Explicit revoke from authenticated, which revoking from public
-- does not cover on Supabase.

create or replace function public.gl_apply_stripe_refund(
  p_event_id       text,
  p_invoice_number text,
  p_charge_id      text,
  p_charge_cents   bigint,
  p_refunded_cents bigint,
  p_base_cents     bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inv       public.invoices%rowtype;
  v_base      bigint;
  v_target    bigint;
  v_prior     bigint;
  v_delta     bigint;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'provider event id is required for an idempotent refund' using errcode = '22023';
  end if;
  if p_charge_id is null or btrim(p_charge_id) = '' then
    raise exception 'charge id is required to reconcile a cumulative refund' using errcode = '22023';
  end if;
  if p_charge_cents is null or p_charge_cents <= 0 or p_refunded_cents is null or p_refunded_cents < 0 then
    return jsonb_build_object('applied', false, 'reason', 'bad_amounts',
      'charge_cents', p_charge_cents, 'refunded_cents', p_refunded_cents);
  end if;

  -- The lock first. Everything below reads state no other ledger writer for
  -- this invoice can change until we commit.
  select * into v_inv from public.invoices where invoice_number = p_invoice_number for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice', 'invoice_number', p_invoice_number);
  end if;

  -- A redelivered event. Checked under the lock so it cannot race its twin.
  if exists (select 1 from public.invoice_payments
              where provider = 'stripe' and provider_event_id = p_event_id) then
    return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
      'invoice_number', p_invoice_number, 'paid_total', public.gl_ledger_net(p_invoice_number));
  end if;

  -- The charge includes the card surcharge; the invoice was settled by the
  -- base only (GL-101). Scale the cumulative refund to the invoice's share.
  v_base := case when p_base_cents is not null and p_base_cents > 0 and p_base_cents <= p_charge_cents
                 then p_base_cents else p_charge_cents end;
  v_target := least(v_base, round(p_refunded_cents::numeric * v_base / p_charge_cents)::bigint);

  select coalesce(round(sum(-ip.amount) * 100), 0)::bigint into v_prior
    from public.invoice_payments ip
   where ip.invoice_number = p_invoice_number
     and ip.provider = 'stripe'
     and ip.event_kind = 'reversal'
     and ip.reference = p_charge_id;

  v_delta := v_target - v_prior;
  if v_delta <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'already_reflected',
      'invoice_number', p_invoice_number, 'target_cents', v_target, 'prior_cents', v_prior);
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
    values
      (p_invoice_number, -(v_delta::numeric / 100), 'Stripe', current_date,
       p_charge_id, 'stripe', p_event_id, 'usd', 'reversal');
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
        'invoice_number', p_invoice_number, 'paid_total', public.gl_ledger_net(p_invoice_number));
    when check_violation then
      return jsonb_build_object('applied', false, 'reason', 'exceeds_refundable',
        'invoice_number', p_invoice_number, 'refund_cents', v_delta,
        'paid_total', public.gl_ledger_net(p_invoice_number));
  end;

  return jsonb_build_object('applied', true, 'reason', 'refunded',
    'invoice_number', p_invoice_number, 'refunded_cents', v_delta,
    'target_cents', v_target, 'prior_cents', v_prior,
    'paid_total', public.gl_ledger_net(p_invoice_number),
    'status', (select i.status from public.invoices i where i.invoice_number = p_invoice_number));
end
$$;

revoke all on function public.gl_apply_stripe_refund(text, text, text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.gl_apply_stripe_refund(text, text, text, bigint, bigint, bigint) to service_role;


create or replace function public.gl_reverse_stripe_session(
  p_event_id       text,   -- the async_payment_failed event
  p_invoice_number text,
  p_session_id     text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_paid numeric;
  v_rev  numeric;
  v_open numeric;
begin
  if p_event_id is null or btrim(p_event_id) = '' or p_session_id is null or btrim(p_session_id) = '' then
    raise exception 'event id and session id are required' using errcode = '22023';
  end if;

  perform 1 from public.invoices where invoice_number = p_invoice_number for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice', 'invoice_number', p_invoice_number);
  end if;

  if exists (select 1 from public.invoice_payments
              where provider = 'stripe' and provider_event_id = p_event_id) then
    return jsonb_build_object('applied', false, 'reason', 'duplicate_event', 'invoice_number', p_invoice_number);
  end if;

  -- A payment for this session: keyed by session (current webhook) or, from an
  -- older deploy, by event id with the session as its reference.
  select coalesce(sum(ip.amount), 0) into v_paid
    from public.invoice_payments ip
   where ip.invoice_number = p_invoice_number and ip.provider = 'stripe' and ip.event_kind = 'payment'
     and (ip.provider_event_id = 'checkout_session:' || p_session_id or ip.reference = p_session_id);
  select coalesce(sum(-ip.amount), 0) into v_rev
    from public.invoice_payments ip
   where ip.invoice_number = p_invoice_number and ip.provider = 'stripe' and ip.event_kind = 'reversal'
     and ip.reference = p_session_id;
  v_open := v_paid - v_rev;

  if v_open <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'already_reflected',
      'invoice_number', p_invoice_number, 'note', 'no settled payment recorded for this session');
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
    values
      (p_invoice_number, -v_open, 'Stripe', current_date, p_session_id, 'stripe', p_event_id, 'usd', 'reversal');
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'duplicate_event', 'invoice_number', p_invoice_number);
    when check_violation then
      return jsonb_build_object('applied', false, 'reason', 'exceeds_refundable',
        'invoice_number', p_invoice_number, 'reversal', v_open);
  end;

  return jsonb_build_object('applied', true, 'reason', 'payment_failed_reversed',
    'invoice_number', p_invoice_number, 'reversed', v_open,
    'paid_total', public.gl_ledger_net(p_invoice_number));
end
$$;

revoke all on function public.gl_reverse_stripe_session(text, text, text) from public, anon, authenticated;
grant execute on function public.gl_reverse_stripe_session(text, text, text) to service_role;

notify pgrst, 'reload schema';
