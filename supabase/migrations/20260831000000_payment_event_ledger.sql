-- Payment integrity: an immutable, idempotent payment-event ledger, and a
-- database guard that stops anything writing paid state around it.
--
-- WHY THIS EXISTS
-- The external audit's definition-of-done item 4 requires that invoice state
-- change "only from server-derived, exact, idempotent payment events inside a
-- database transaction". Before this migration none of those four words held:
--
--   * `stripe-webhook` PATCHed `invoices` directly with `status='paid'`. The
--     amount came from Stripe rather than the request, so it was server-derived
--     and exact -- but a redelivered webhook (Stripe retries for up to three
--     days) re-applied it, and there was no transaction and no ledger.
--   * Staff marked invoices paid from the browser with a plain UPDATE.
--   * `invoice_payments` existed but nothing except the accounting screen wrote
--     to it: 19 invoices, 15 of them 'paid', and 4 ledger rows. The ledger was
--     decorative; `invoices.status` was the system of record.
--
-- After this migration the ledger IS the system of record for paid state, and
-- `invoices.status` is derived from it inside one locked transaction.
--
-- WHAT DOES NOT CHANGE
-- Credit memos are INSERTed with status 'paid' and a negative amount; the guard
-- below fires on UPDATE only, so they are untouched. The nightly overdue job
-- moves pending->overdue, which touches no paid column and is likewise allowed.
--
-- ROLLBACK:
--   drop trigger if exists invoices_guard_paid_state on public.invoices;
--   drop function if exists public.gl_guard_invoice_paid_state();
--   drop trigger if exists invoice_payments_immutable on public.invoice_payments;
--   drop function if exists public.gl_invoice_payments_immutable();
--   drop function if exists public.gl_reverse_invoice_payments(text, text);
--   drop function if exists public.gl_record_manual_payment(text, numeric, text, text);
--   drop function if exists public.gl_apply_payment_event(text, text, text, numeric, text, text, text);
--   drop function if exists public.gl_invoice_paid_total(text);
--   drop index if exists public.invoice_payments_provider_event_key;
--   delete from public.invoice_payments where event_kind = 'legacy_backfill';
--   alter table public.invoice_payments
--     drop column if exists provider, drop column if exists provider_event_id,
--     drop column if exists currency, drop column if exists event_kind;

set search_path = public, extensions;

-- ---------------------------------------------------------------- ledger shape

alter table public.invoice_payments
  add column if not exists provider          text,
  add column if not exists provider_event_id text,
  add column if not exists currency          text not null default 'usd',
  add column if not exists event_kind        text not null default 'payment';

do $ledger_kind$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_payments'::regclass
      and conname  = 'invoice_payments_event_kind_check'
  ) then
    alter table public.invoice_payments
      add constraint invoice_payments_event_kind_check
      check (event_kind in ('payment', 'reversal', 'legacy_backfill'));
  end if;
end
$ledger_kind$;

-- The table already carried `check (amount > 0)`, which makes a reversing entry
-- impossible -- and a ledger that cannot express a correction is a ledger that
-- has to be edited, which is the thing the immutability trigger below forbids.
-- Signed amounts, with the sign tied to the kind of event, so `sum(amount)` is
-- the net paid figure for every existing reader without their changing.
alter table public.invoice_payments drop constraint if exists invoice_payments_amount_check;

do $ledger_sign$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_payments'::regclass
      and conname  = 'invoice_payments_amount_sign_check'
  ) then
    alter table public.invoice_payments
      add constraint invoice_payments_amount_sign_check
      check ((event_kind = 'reversal' and amount < 0)
          or (event_kind <> 'reversal' and amount > 0));
  end if;
end
$ledger_sign$;

-- `method` is constrained to a fixed vocabulary the accounting screen renders
-- from a <select>. Ledger events map onto it rather than widening it, so the
-- existing screen keeps working; the machine-readable nature of an event lives
-- in `event_kind` and `provider`.
create or replace function public.gl_payment_method_label(p_method text, p_provider text default null)
returns text
language sql
immutable
set search_path = public, extensions
as $method_label$
  select case
           when lower(coalesce(p_provider, '')) = 'stripe' then 'Stripe'
           when p_method in ('Check', 'Wire transfer', 'ACH', 'Cash', 'Stripe', 'Other') then p_method
           else 'Other'
         end;
$method_label$;

-- Idempotency. Partial, because manual staff payments carry no provider event
-- id and two cash payments of the same amount on the same day are legitimate.
-- A redelivered Stripe event has the same id and is refused by this index.
create unique index if not exists invoice_payments_provider_event_key
  on public.invoice_payments (provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists invoice_payments_invoice_number_idx
  on public.invoice_payments (invoice_number);

-- ------------------------------------------------------------- immutability

-- A ledger you can edit is not a ledger. Corrections are additional rows -- a
-- 'reversal' with a negative amount -- so the history of what was believed and
-- when stays readable. This is what makes the audit trail worth having.
create or replace function public.gl_invoice_payments_immutable()
returns trigger
language plpgsql
set search_path = public, extensions
as $immutable$
begin
  raise exception
    'invoice_payments is append-only: % is not permitted. Insert a reversal row instead.',
    tg_op
    using errcode = '42501';
  return null;
end
$immutable$;

drop trigger if exists invoice_payments_immutable on public.invoice_payments;
create trigger invoice_payments_immutable
  before update or delete on public.invoice_payments
  for each row execute function public.gl_invoice_payments_immutable();

-- --------------------------------------------------------------- backfill

-- 15 invoices are 'paid' and only 4 have ledger rows. Deriving status from the
-- ledger without this would silently un-pay eleven real invoices on the first
-- recompute. Each backfill row is labelled so it is never mistaken for a
-- payment that was actually observed.
insert into public.invoice_payments
  (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
select
  i.invoice_number,
  i.amount - coalesce((
    select sum(p.amount) from public.invoice_payments p
    where p.invoice_number = i.invoice_number
  ), 0),
  'Other',
  coalesce(i.paid_at::date, i.invoice_date, current_date),
  'Backfilled 2026-08-31: invoice was already marked paid before the ledger existed',
  null, null, 'usd', 'legacy_backfill'
from public.invoices i
where i.status = 'paid'
  and coalesce(i.is_credit_memo, false) = false
  and i.amount > 0
  and i.amount - coalesce((
        select sum(p.amount) from public.invoice_payments p
        where p.invoice_number = i.invoice_number
      ), 0) > 0
  and not exists (
    select 1 from public.invoice_payments b
    where b.invoice_number = i.invoice_number and b.event_kind = 'legacy_backfill'
  );

-- ------------------------------------------------------------------ helpers

create or replace function public.gl_invoice_paid_total(p_invoice_number text)
returns numeric
language sql
stable
set search_path = public, extensions
as $paid_total$
  select coalesce(sum(amount), 0)::numeric
  from public.invoice_payments
  where invoice_number = p_invoice_number;
$paid_total$;

-- ------------------------------------------------------------------- guard

-- Nothing may assert paid state except the RPCs below, which set
-- `gl.payment_apply` for the duration of their transaction. This is what makes
-- "staff must not directly patch paid state" enforceable rather than a
-- convention -- a browser UPDATE, a psql session and a service-role PATCH are
-- all refused identically.
create or replace function public.gl_guard_invoice_paid_state()
returns trigger
language plpgsql
set search_path = public, extensions
as $guard$
declare
  becoming_paid boolean;
  paid_cols_changed boolean;
begin
  becoming_paid := (new.status = 'paid' and coalesce(old.status, '') <> 'paid');
  paid_cols_changed :=
       new.paid_at           is distinct from old.paid_at
    or new.paid_amount       is distinct from old.paid_amount
    or new.paid_method       is distinct from old.paid_method
    or new.stripe_session_id is distinct from old.stripe_session_id;

  if (becoming_paid or paid_cols_changed)
     and coalesce(current_setting('gl.payment_apply', true), '') <> '1' then
    raise exception
      'Paid state on invoices is derived from the payment ledger. Call gl_apply_payment_event, gl_record_manual_payment or gl_reverse_invoice_payments instead of updating % directly.',
      new.invoice_number
      using errcode = '42501';
  end if;

  return new;
end
$guard$;

drop trigger if exists invoices_guard_paid_state on public.invoices;
create trigger invoices_guard_paid_state
  before update on public.invoices
  for each row execute function public.gl_guard_invoice_paid_state();

-- ------------------------------------------------------- apply a provider event

-- One transaction: lock the invoice, refuse a replay, record the event, derive
-- the status. Returns a verdict rather than raising on a duplicate, because a
-- webhook that 500s is retried forever and a duplicate is a success, not a
-- fault.
create or replace function public.gl_apply_payment_event(
  p_provider        text,
  p_event_id        text,
  p_invoice_number  text,
  p_amount          numeric,
  p_currency        text,
  p_method          text,
  p_reference       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $apply$
declare
  inv           public.invoices%rowtype;
  already       public.invoice_payments%rowtype;
  new_total     numeric;
  new_status    text;
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

  -- Replay check before the lock: the common retry costs nothing.
  select * into already from public.invoice_payments
   where provider = p_provider and provider_event_id = p_event_id;
  if found then
    return jsonb_build_object(
      'applied', false, 'reason', 'duplicate_event',
      'invoice_number', already.invoice_number,
      'paid_total', public.gl_invoice_paid_total(already.invoice_number)
    );
  end if;

  select * into inv from public.invoices
   where invoice_number = p_invoice_number
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice',
                              'invoice_number', p_invoice_number);
  end if;

  if lower(coalesce(p_currency, 'usd')) <> 'usd' then
    return jsonb_build_object('applied', false, 'reason', 'unsupported_currency',
                              'currency', p_currency);
  end if;

  -- Exactness. An amount that does not match what is owed is recorded but
  -- flagged, never silently treated as settlement of a different figure.
  if p_amount > inv.amount then
    return jsonb_build_object('applied', false, 'reason', 'amount_exceeds_invoice',
                              'invoice_amount', inv.amount, 'event_amount', p_amount);
  end if;

  -- The SELECT above catches the ordinary retry, which arrives seconds or hours
  -- later. It cannot catch two deliveries in flight at the same instant: both
  -- read no row, both proceed. The unique index settles that race, and catching
  -- it here turns the loser into the same graceful 'duplicate_event' the
  -- sequential retry gets, instead of a 500 that makes Stripe retry a third time.
  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
    values
      (p_invoice_number, p_amount, public.gl_payment_method_label(p_method, p_provider), current_date,
       p_reference, p_provider, p_event_id, lower(coalesce(p_currency, 'usd')), 'payment');
  exception when unique_violation then
    return jsonb_build_object(
      'applied', false, 'reason', 'duplicate_event',
      'invoice_number', p_invoice_number,
      'paid_total', public.gl_invoice_paid_total(p_invoice_number)
    );
  end;

  new_total  := public.gl_invoice_paid_total(p_invoice_number);
  new_status := case when inv.amount > 0 and new_total >= inv.amount then 'paid'
                     else coalesce(nullif(inv.status, 'paid'), 'pending') end;

  perform set_config('gl.payment_apply', '1', true);
  update public.invoices
     set status            = new_status,
         paid_amount       = new_total,
         paid_at           = case when new_status = 'paid' then coalesce(inv.paid_at, now()) else null end,
         paid_method       = case when new_status = 'paid' then public.gl_payment_method_label(p_method, p_provider) else null end,
         stripe_session_id = case when p_provider = 'stripe' then p_reference else inv.stripe_session_id end,
         updated_at        = now()
   where invoice_number = p_invoice_number;
  perform set_config('gl.payment_apply', '0', true);

  return jsonb_build_object('applied', true, 'reason', 'applied',
                            'invoice_number', p_invoice_number,
                            'paid_total', new_total, 'status', new_status);
end
$apply$;

revoke all on function public.gl_apply_payment_event(text, text, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.gl_apply_payment_event(text, text, text, numeric, text, text, text) to service_role;

-- ---------------------------------------------------------- provider refund

-- A refund is a provider event too, and Stripe redelivers `charge.refunded`
-- exactly like any other. Before this it was a PATCH setting paid_at and
-- paid_amount to null whose result was logged and never checked -- so a
-- redelivered refund re-applied, and a rejected one looked identical to a
-- successful one. Keyed on the refund's own event id, so it is replay-safe.
create or replace function public.gl_apply_refund_event(
  p_provider        text,
  p_event_id        text,
  p_invoice_number  text,
  p_amount          numeric default null,
  p_reference       text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $refund$
declare
  inv        public.invoices%rowtype;
  already    public.invoice_payments%rowtype;
  amt        numeric;
  new_total  numeric;
  new_status text;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'provider event id is required for an idempotent refund' using errcode = '22023';
  end if;

  select * into already from public.invoice_payments
   where provider = p_provider and provider_event_id = p_event_id;
  if found then
    return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
      'invoice_number', already.invoice_number,
      'paid_total', public.gl_invoice_paid_total(already.invoice_number));
  end if;

  select * into inv from public.invoices
   where invoice_number = p_invoice_number
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice',
                              'invoice_number', p_invoice_number);
  end if;

  -- A refund with no figure reverses whatever is currently recorded as paid.
  amt := abs(coalesce(p_amount, public.gl_invoice_paid_total(p_invoice_number)));
  if amt <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'nothing_to_refund',
                              'paid_total', public.gl_invoice_paid_total(p_invoice_number));
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind)
    values
      (p_invoice_number, -amt, public.gl_payment_method_label(null, p_provider), current_date,
       coalesce(p_reference, 'refund'), p_provider, p_event_id, 'usd', 'reversal');
  exception when unique_violation then
    return jsonb_build_object('applied', false, 'reason', 'duplicate_event',
      'invoice_number', p_invoice_number,
      'paid_total', public.gl_invoice_paid_total(p_invoice_number));
  end;

  new_total  := public.gl_invoice_paid_total(p_invoice_number);
  new_status := case when inv.amount > 0 and new_total >= inv.amount then 'paid' else 'pending' end;

  perform set_config('gl.payment_apply', '1', true);
  update public.invoices
     set status      = new_status,
         paid_amount = case when new_status = 'paid' then new_total else null end,
         paid_at     = case when new_status = 'paid' then inv.paid_at else null end,
         paid_method = case when new_status = 'paid' then inv.paid_method else null end,
         updated_at  = now()
   where invoice_number = p_invoice_number;
  perform set_config('gl.payment_apply', '0', true);

  return jsonb_build_object('applied', true, 'reason', 'refunded',
                            'invoice_number', p_invoice_number,
                            'refunded_amount', amt,
                            'paid_total', new_total, 'status', new_status);
end
$refund$;

revoke all on function public.gl_apply_refund_event(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.gl_apply_refund_event(text, text, text, numeric, text) to service_role;

-- ------------------------------------------------------ staff manual payment

-- Staff keep the ability to record a payment that arrived as a cheque or a
-- transfer -- but it becomes an auditable event attributed to them, not an
-- invisible UPDATE. auth.uid() is recorded by the function, not supplied by the
-- caller.
create or replace function public.gl_record_manual_payment(
  p_invoice_number text,
  p_amount         numeric default null,
  p_method         text    default 'manual',
  p_reference      text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $manual$
declare
  inv        public.invoices%rowtype;
  amt        numeric;
  new_total  numeric;
  new_status text;
begin
  if not public.is_gl_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select * into inv from public.invoices
   where invoice_number = p_invoice_number
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice',
                              'invoice_number', p_invoice_number);
  end if;

  -- Marking an invoice paid with no figure means "settle the balance", which is
  -- what the button in the CRM has always meant.
  amt := coalesce(p_amount, inv.amount - public.gl_invoice_paid_total(p_invoice_number));
  if amt <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'nothing_outstanding',
                              'paid_total', public.gl_invoice_paid_total(p_invoice_number));
  end if;

  insert into public.invoice_payments
    (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind, created_by)
  values
    (p_invoice_number, amt, public.gl_payment_method_label(p_method), current_date,
     p_reference, 'manual', null, 'usd', 'payment', auth.uid());

  new_total  := public.gl_invoice_paid_total(p_invoice_number);
  new_status := case when inv.amount > 0 and new_total >= inv.amount then 'paid' else 'pending' end;

  perform set_config('gl.payment_apply', '1', true);
  update public.invoices
     set status      = new_status,
         paid_amount = new_total,
         paid_at     = case when new_status = 'paid' then now() else null end,
         paid_method = case when new_status = 'paid' then public.gl_payment_method_label(p_method) else null end,
         updated_at  = now()
   where invoice_number = p_invoice_number;
  perform set_config('gl.payment_apply', '0', true);

  return jsonb_build_object('applied', true, 'reason', 'applied',
                            'invoice_number', p_invoice_number,
                            'paid_total', new_total, 'status', new_status);
end
$manual$;

revoke all on function public.gl_record_manual_payment(text, numeric, text, text) from public, anon;
grant execute on function public.gl_record_manual_payment(text, numeric, text, text) to authenticated, service_role;

-- ------------------------------------------------------------- reversal

-- The inverse of marking paid, added as GL-054 because there was no way back.
-- Under the ledger it is a reversing event, not a deletion: the original
-- payment and the correction both stay on the record.
create or replace function public.gl_reverse_invoice_payments(
  p_invoice_number text,
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $reverse$
declare
  inv        public.invoices%rowtype;
  outstanding numeric;
begin
  if not public.is_gl_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select * into inv from public.invoices
   where invoice_number = p_invoice_number
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_invoice');
  end if;

  outstanding := public.gl_invoice_paid_total(p_invoice_number);

  if outstanding <> 0 then
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference, provider, provider_event_id, currency, event_kind, created_by)
    values
      (p_invoice_number, -outstanding, 'Other', current_date,
       coalesce(p_reason, 'Marked unpaid from the CRM'), 'manual', null, 'usd', 'reversal', auth.uid());
  end if;

  perform set_config('gl.payment_apply', '1', true);
  update public.invoices
     set status      = 'pending',
         paid_amount = null,
         paid_at     = null,
         paid_method = null,
         updated_at  = now()
   where invoice_number = p_invoice_number;
  perform set_config('gl.payment_apply', '0', true);

  return jsonb_build_object('applied', true, 'reason', 'reversed',
                            'invoice_number', p_invoice_number,
                            'reversed_amount', outstanding, 'status', 'pending');
end
$reverse$;

revoke all on function public.gl_reverse_invoice_payments(text, text) from public, anon;
grant execute on function public.gl_reverse_invoice_payments(text, text) to authenticated, service_role;
