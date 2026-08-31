-- Payment ledger hardening — five defects found by the external auditor in the
-- design shipped hours earlier in 20260831000000_payment_event_ledger.sql.
--
-- All five were real. The first was reproduced before being fixed: an invoice
-- with ZERO ledger rows was driven to `paid / paid_amount = 9999` by two lines
-- of SQL, and the previous response document claimed that could not happen.
--
-- 1. THE GUARD WAS FORGEABLE  (auditor 2.1, CRITICAL)
--    It trusted `current_setting('gl.payment_apply') = '1'`. A custom GUC is
--    coordination state, not an authorization boundary: any SQL-capable caller
--    can set it and then write whatever they like. The claim that "a browser
--    UPDATE, a psql session and a service-role PATCH are all refused
--    identically" was false.
--
--    Replaced with something no caller can manufacture: the guard now checks
--    the write against the LEDGER. To mark an invoice paid you must have
--    inserted ledger rows that add up, and the ledger is append-only with its
--    own bounds. There is no flag to set, no depth to fake and no privilege to
--    borrow — the invariant is arithmetic, and it is checked on every write.
--
-- 2. DISTINCT EVENTS COULD CUMULATIVELY OVERPAY  (auditor 2.2, HIGH)
--    Each event was compared with the invoice total rather than the remaining
--    balance, so two $700 events against a $1,000 invoice both passed and the
--    ledger reached $1,400. The row lock serialised them and then let both in.
--
-- 3. REFUNDS COULD EXCEED THE REFUNDABLE BALANCE  (auditor 2.3, HIGH)
--    `abs(coalesce(p_amount, …))` with no cap, so a refund could drive the net
--    ledger negative.
--
-- 4. PARTIAL REFUNDS PRODUCED INCONSISTENT DERIVED STATE  (auditor 2.4)
--    The refund path set `paid_amount = null` whenever the invoice was no
--    longer fully paid, discarding a real partial balance that every other path
--    preserves.
--
-- Bounds 2 and 3 are enforced in a BEFORE INSERT trigger on the ledger, not in
-- the RPCs. Putting them in the RPCs would leave them true only for callers who
-- use the RPCs, which is the same mistake as trusting a session flag.
--
-- ROLLBACK:
--   drop trigger if exists invoice_payments_enforce_bounds on public.invoice_payments;
--   drop trigger if exists invoice_payments_derive_invoice on public.invoice_payments;
--   drop function if exists public.gl_enforce_ledger_bounds();
--   drop function if exists public.gl_derive_invoice_paid_state();
--   -- then restore the previous guard from 20260831000000 if truly reverting:
--   -- it is forgeable, so prefer rolling forward.

set search_path = public, extensions;

-- ------------------------------------------------------------------ helpers

-- Inline rather than via gl_invoice_paid_total() so the trigger reads the
-- transaction's own uncommitted rows without depending on the STABLE function's
-- snapshot behaviour.
create or replace function public.gl_ledger_net(p_invoice_number text)
returns numeric
language sql
volatile
set search_path = public, extensions
as $net$
  select coalesce(sum(amount), 0)::numeric
    from public.invoice_payments
   where invoice_number = p_invoice_number;
$net$;

-- --------------------------------------------------- bounds, at the ledger

-- Every insert is checked against the invoice under its own row lock, so two
-- concurrent events cannot each see the pre-payment balance. The lock is taken
-- here, in the ledger trigger, which means it protects direct INSERTs as well
-- as the RPCs.
create or replace function public.gl_enforce_ledger_bounds()
returns trigger
language plpgsql
set search_path = public, extensions
as $bounds$
declare
  inv_amount numeric;
  net_before numeric;
  net_after  numeric;
begin
  select amount into inv_amount
    from public.invoices
   where invoice_number = new.invoice_number
   for update;
  if not found then
    raise exception 'no such invoice: %', new.invoice_number using errcode = '23503';
  end if;

  select coalesce(sum(amount), 0) into net_before
    from public.invoice_payments
   where invoice_number = new.invoice_number;

  net_after := net_before + new.amount;

  -- A reversal may not take more out than is in.
  if new.amount < 0 and net_after < 0 then
    raise exception
      'refund of % exceeds the refundable balance of % on %',
      abs(new.amount), net_before, new.invoice_number
      using errcode = '23514';
  end if;

  -- A payment may not take the invoice past what is owed. Credit memos carry a
  -- negative invoice amount and are settled on creation, so they are exempt;
  -- there is nothing to overpay.
  if new.amount > 0 and inv_amount > 0 and net_after > inv_amount then
    raise exception
      'payment of % would take % to %, over its balance of %',
      new.amount, new.invoice_number, net_after, inv_amount
      using errcode = '23514';
  end if;

  return new;
end
$bounds$;

drop trigger if exists invoice_payments_enforce_bounds on public.invoice_payments;
create trigger invoice_payments_enforce_bounds
  before insert on public.invoice_payments
  for each row execute function public.gl_enforce_ledger_bounds();

-- ------------------------------------------- derive the invoice from the ledger

-- The ledger is the system of record; the invoice row is a projection of it.
-- Doing this in a trigger rather than in each RPC means a direct INSERT derives
-- the same state, and there is one place where the projection is defined.
create or replace function public.gl_derive_invoice_paid_state()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $derive$
declare
  inv        public.invoices%rowtype;
  net        numeric;
  new_status text;
begin
  select * into inv from public.invoices
   where invoice_number = new.invoice_number
   for update;
  if not found then return new; end if;

  select coalesce(sum(amount), 0) into net
    from public.invoice_payments
   where invoice_number = new.invoice_number;

  -- Credit memos are inserted settled, with a negative amount. Deriving them
  -- from a >= test would flip every one of them to 'pending'.
  new_status := case
    when coalesce(inv.is_credit_memo, false)   then inv.status
    when inv.amount > 0 and net >= inv.amount then 'paid'
    when inv.status = 'paid'                  then 'pending'   -- no longer covered
    else coalesce(nullif(inv.status, 'paid'), 'pending')
  end;

  update public.invoices
     set status      = new_status,
         -- Always the net, never erased. A part-refunded invoice keeps its
         -- partial balance visible; only `status` says whether it is settled.
         paid_amount = greatest(net, 0),
         paid_at     = case when new_status = 'paid' then coalesce(inv.paid_at, now()) else null end,
         paid_method = case when new_status = 'paid'
                            then coalesce(inv.paid_method, new.method) else null end,
         stripe_session_id = case
             when new.provider = 'stripe' and new.event_kind = 'payment'
               then coalesce(new.reference, inv.stripe_session_id)
             else inv.stripe_session_id end,
         updated_at  = now()
   where invoice_number = new.invoice_number;

  return new;
end
$derive$;

drop trigger if exists invoice_payments_derive_invoice on public.invoice_payments;
create trigger invoice_payments_derive_invoice
  after insert on public.invoice_payments
  for each row execute function public.gl_derive_invoice_paid_state();

-- ------------------------------------------------- the guard, made unforgeable

-- The previous version asked "did the caller set the flag?", which any caller
-- could answer yes to. This one asks "is what you are writing what the ledger
-- says?" — a question a caller cannot lie about, because the only way to change
-- the answer is to insert ledger rows, which are append-only and bounded above.
--
-- The check is therefore an INVARIANT, not a permission. It does not care who
-- is writing. A correct write from any source passes; an unsupported one fails
-- from every source, including the service role and the table owner.
create or replace function public.gl_guard_invoice_paid_state()
returns trigger
language plpgsql
set search_path = public, extensions
as $guard$
declare
  net numeric;
begin
  -- Nothing about payment changed: not our business.
  if new.status is not distinct from old.status
     and new.paid_at           is not distinct from old.paid_at
     and new.paid_amount       is not distinct from old.paid_amount
     and new.paid_method       is not distinct from old.paid_method
     and new.stripe_session_id is not distinct from old.stripe_session_id then
    return new;
  end if;

  select coalesce(sum(amount), 0) into net
    from public.invoice_payments
   where invoice_number = new.invoice_number;

  -- An invoice is paid only when the ledger actually covers it.
  if new.status = 'paid'
     and not coalesce(new.is_credit_memo, false)
     and not (new.amount > 0 and net >= new.amount) then
    raise exception
      'cannot mark % paid: the payment ledger records % against a balance of %. Record a payment event instead.',
      new.invoice_number, net, new.amount
      using errcode = '42501';
  end if;

  -- The recorded amount is the ledger's net, or nothing when there is nothing.
  if new.paid_amount is distinct from old.paid_amount
     and new.paid_amount is distinct from greatest(net, 0)
     and not (new.paid_amount is null and net = 0) then
    raise exception
      'paid_amount on % must equal the ledger net of %, not %',
      new.invoice_number, greatest(net, 0), new.paid_amount
      using errcode = '42501';
  end if;

  -- A payment reference has to correspond to a real event.
  if new.stripe_session_id is distinct from old.stripe_session_id
     and new.stripe_session_id is not null
     and not exists (
       select 1 from public.invoice_payments p
        where p.invoice_number = new.invoice_number
          and p.reference = new.stripe_session_id
     ) then
    raise exception
      'stripe_session_id % on % matches no payment event',
      new.stripe_session_id, new.invoice_number
      using errcode = '42501';
  end if;

  -- An unpaid invoice carries no payment date. Checked only when paid_at or
  -- the status actually CHANGES: a guard that also judges pre-existing state
  -- makes those rows unwritable, and production had one (GL-1015, left
  -- 'overdue' with a stale paid_at by a mark-paid/mark-unpaid cycle earlier
  -- today). The reconcile step below cleans it; the guard polices writes.
  if new.status <> 'paid' and new.paid_at is not null
     and (new.paid_at is distinct from old.paid_at or new.status is distinct from old.status)
     and not coalesce(new.is_credit_memo, false) then
    raise exception
      'paid_at is set on % but its status is %', new.invoice_number, new.status
      using errcode = '42501';
  end if;

  return new;
end
$guard$;

drop trigger if exists invoices_guard_paid_state on public.invoices;
create trigger invoices_guard_paid_state
  before update on public.invoices
  for each row execute function public.gl_guard_invoice_paid_state();

-- ------------------------------------------------------ the RPCs, made thin

-- The triggers now own the bounds and the projection, so these do three things:
-- refuse a replay, insert, and translate a bound violation into a verdict the
-- webhook can act on. A raise here would become a 500 and a Stripe retry.

create or replace function public.gl_apply_payment_event(
  p_provider text, p_event_id text, p_invoice_number text,
  p_amount numeric, p_currency text, p_method text, p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $apply$
declare
  already public.invoice_payments%rowtype;
  inv     public.invoices%rowtype;
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'provider is required' using errcode = '22023';
  end if;
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'provider event id is required for an idempotent apply' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive' using errcode = '22023';
  end if;
  if lower(coalesce(p_currency, 'usd')) <> 'usd' then
    return jsonb_build_object('applied', false, 'reason', 'unsupported_currency', 'currency', p_currency);
  end if;

  select * into already from public.invoice_payments
   where provider = p_provider and provider_event_id = p_event_id;
  if found then
    return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
      'invoice_number', already.invoice_number,
      'paid_total', public.gl_ledger_net(already.invoice_number));
  end if;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice',
                              'invoice_number', p_invoice_number);
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
    values
      (p_invoice_number, p_amount, public.gl_payment_method_label(p_method, p_provider), current_date,
       p_reference, p_provider, p_event_id, lower(coalesce(p_currency, 'usd')), 'payment');
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
        'invoice_number', p_invoice_number, 'paid_total', public.gl_ledger_net(p_invoice_number));
    when check_violation then
      return jsonb_build_object('applied', false, 'reason', 'exceeds_balance',
        'invoice_number', p_invoice_number,
        'invoice_amount', inv.amount,
        'already_paid', public.gl_ledger_net(p_invoice_number),
        'event_amount', p_amount);
  end;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  return jsonb_build_object('applied', true, 'reason', 'applied',
                            'invoice_number', p_invoice_number,
                            'paid_total', public.gl_ledger_net(p_invoice_number),
                            'status', inv.status);
end
$apply$;

revoke all on function public.gl_apply_payment_event(text, text, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.gl_apply_payment_event(text, text, text, numeric, text, text, text) to service_role;

create or replace function public.gl_apply_refund_event(
  p_provider text, p_event_id text, p_invoice_number text,
  p_amount numeric default null, p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $refund$
declare
  already public.invoice_payments%rowtype;
  inv     public.invoices%rowtype;
  amt     numeric;
  net     numeric;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'provider event id is required for an idempotent refund' using errcode = '22023';
  end if;

  select * into already from public.invoice_payments
   where provider = p_provider and provider_event_id = p_event_id;
  if found then
    return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
      'invoice_number', already.invoice_number,
      'paid_total', public.gl_ledger_net(already.invoice_number));
  end if;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice',
                              'invoice_number', p_invoice_number);
  end if;

  net := public.gl_ledger_net(p_invoice_number);
  amt := abs(coalesce(p_amount, net));
  if amt <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'nothing_to_refund', 'paid_total', net);
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
    values
      (p_invoice_number, -amt, public.gl_payment_method_label(null, p_provider), current_date,
       coalesce(p_reference, 'refund'), p_provider, p_event_id, 'usd', 'reversal');
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
        'invoice_number', p_invoice_number, 'paid_total', public.gl_ledger_net(p_invoice_number));
    when check_violation then
      return jsonb_build_object('applied', false, 'reason', 'exceeds_refundable',
        'invoice_number', p_invoice_number,
        'refundable', net, 'refund_amount', amt);
  end;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  return jsonb_build_object('applied', true, 'reason', 'refunded',
                            'invoice_number', p_invoice_number,
                            'refunded_amount', amt,
                            'paid_total', public.gl_ledger_net(p_invoice_number),
                            'status', inv.status);
end
$refund$;

revoke all on function public.gl_apply_refund_event(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.gl_apply_refund_event(text, text, text, numeric, text) to service_role;

create or replace function public.gl_record_manual_payment(
  p_invoice_number text, p_amount numeric default null,
  p_method text default 'manual', p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $manual$
declare
  inv       public.invoices%rowtype;
  net       numeric;
  remaining numeric;
  amt       numeric;
begin
  if not public.is_gl_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice',
                              'invoice_number', p_invoice_number);
  end if;

  net       := public.gl_ledger_net(p_invoice_number);
  remaining := inv.amount - net;
  amt       := coalesce(p_amount, remaining);

  if amt <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'nothing_outstanding', 'paid_total', net);
  end if;
  -- Refused here as well as in the trigger, so the caller gets a verdict that
  -- names the balance rather than a check-constraint error.
  if inv.amount > 0 and amt > remaining then
    return jsonb_build_object('applied', false, 'reason', 'exceeds_balance',
      'invoice_number', p_invoice_number, 'invoice_amount', inv.amount,
      'already_paid', net, 'remaining', remaining, 'requested', amt);
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind, created_by)
    values
      (p_invoice_number, amt, public.gl_payment_method_label(p_method), current_date,
       p_reference, 'manual', null, 'usd', 'payment', auth.uid());
  exception when check_violation then
    return jsonb_build_object('applied', false, 'reason', 'exceeds_balance',
      'invoice_number', p_invoice_number, 'already_paid', public.gl_ledger_net(p_invoice_number));
  end;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  return jsonb_build_object('applied', true, 'reason', 'applied',
                            'invoice_number', p_invoice_number,
                            'paid_total', public.gl_ledger_net(p_invoice_number),
                            'status', inv.status);
end
$manual$;

revoke all on function public.gl_record_manual_payment(text, numeric, text, text) from public, anon;
grant execute on function public.gl_record_manual_payment(text, numeric, text, text) to authenticated, service_role;

create or replace function public.gl_reverse_invoice_payments(
  p_invoice_number text, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $reverse$
declare
  inv public.invoices%rowtype;
  net numeric;
begin
  if not public.is_gl_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice');
  end if;

  net := public.gl_ledger_net(p_invoice_number);

  if net > 0 then
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind, created_by)
    values
      (p_invoice_number, -net, 'Other', current_date,
       coalesce(p_reason, 'Marked unpaid from the CRM'), 'manual', null, 'usd', 'reversal', auth.uid());
  else
    -- Nothing to reverse, but the invoice may still be sitting on a stale
    -- 'paid' with no ledger behind it. The guard permits this: net is 0, so
    -- 'pending' is what the ledger supports.
    update public.invoices
       set status = 'pending', paid_amount = 0, paid_at = null, paid_method = null, updated_at = now()
     where invoice_number = p_invoice_number and status = 'paid';
  end if;

  select * into inv from public.invoices where invoice_number = p_invoice_number;
  return jsonb_build_object('applied', true, 'reason', 'reversed',
                            'invoice_number', p_invoice_number,
                            'reversed_amount', net,
                            'paid_total', public.gl_ledger_net(p_invoice_number),
                            'status', inv.status);
end
$reverse$;

revoke all on function public.gl_reverse_invoice_payments(text, text) from public, anon;
grant execute on function public.gl_reverse_invoice_payments(text, text) to authenticated, service_role;

-- ------------------------------------------------------------- reconciliation

-- Bring every existing invoice's projection into line with its ledger, so the
-- guard's invariant holds for the whole table from this point on rather than
-- only for rows touched after the migration.
do $reconcile$
declare
  r record;
begin
  for r in
    select i.invoice_number, i.amount, i.status, i.paid_amount,
           coalesce((select sum(p.amount) from public.invoice_payments p
                      where p.invoice_number = i.invoice_number), 0) as net
      from public.invoices i
     where coalesce(i.is_credit_memo, false) = false
  loop
    if r.paid_amount is distinct from greatest(r.net, 0) then
      update public.invoices
         set paid_amount = greatest(r.net, 0), updated_at = now()
       where invoice_number = r.invoice_number;
    end if;
    -- Clear payment evidence left on invoices the ledger says are not paid.
    if r.status <> 'paid' then
      update public.invoices
         set paid_at = null, paid_method = null, updated_at = now()
       where invoice_number = r.invoice_number
         and (paid_at is not null or paid_method is not null);
    end if;
  end loop;
end
$reconcile$;
