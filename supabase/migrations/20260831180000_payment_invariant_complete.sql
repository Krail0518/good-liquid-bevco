-- Payment invariant, completed — the third round on this control.
--
-- The auditor found that the guard shipped in 20260831120000 returns early
-- whenever the five payment columns are unchanged, and that the early return
-- happens BEFORE the ledger is read. `amount`, `invoice_number` and
-- `is_credit_memo` are not in that condition, and each one changes the meaning
-- of the invariant. Reproduced on staging before fixing:
--
--   T1  raise amount 1000 -> 2000 on a fully paid invoice
--       ALLOWED: status=paid, ledger=1000, amount=2000   (paid without cover)
--   T2  lower amount 1000 -> 500 with a 1000 ledger
--       ALLOWED: ledger 1000 against a 500 invoice        (ledger over invoice)
--   T4  toggle is_credit_memo with ledger rows            ALLOWED
--   T7  set paid_method with no matching ledger event     ALLOWED
--   T6b status paid -> pending while fully covered, clearing paid_at in the
--       same statement                                    ALLOWED
--
-- Two of the auditor's cases were already handled and are recorded as such:
--   T5  rename invoice_number with ledger rows  refused 23503 by the existing
--       foreign key. Kept, and now also refused explicitly with a readable
--       message rather than an FK error.
--   T6a status-only paid -> pending was already refused, but incidentally, by
--       the paid_at rule. T6b showed the same end state was reachable by
--       clearing paid_at in the same statement, so the auditor's finding stands.
--
-- WHAT CHANGES
--
-- The early return now covers all eight columns that bear on the invariant, and
-- the invariant itself is stated in ONE place -- gl_invoice_derived_status() --
-- used by the projection trigger, the guard, and the migration reconciliation.
-- The auditor asked for exactly that: migration-time and runtime behaviour
-- cannot diverge if they call the same function.
--
-- Both directions are enforced for ordinary positive invoices: status is 'paid'
-- exactly when the ledger covers the amount, and the ledger may never exceed
-- the amount beyond a stated rounding tolerance.
--
-- ON THE TOLERANCE
-- GL-1011.amount is stored as 253.08999999999997 -- a browser float written into
-- a numeric column -- while its ledger row, at scale 2, is 253.09. Without a
-- tolerance that invoice is permanently 'ledger over invoice' and unwritable.
-- The tolerance is half a cent, which is smaller than any real payment and
-- larger than any float artifact of this kind.
--
-- ROLLBACK:
--   drop trigger if exists invoices_guard_paid_state on public.invoices;
--   drop function if exists public.gl_guard_invoice_paid_state();
--   drop function if exists public.gl_invoice_derived_status(numeric, boolean, text, numeric);
--   -- and restore the 20260831120000 definitions, which are bypassable by an
--   -- ordinary amount edit; prefer rolling forward.

set search_path = public, extensions;

-- ------------------------------------------------------------- the invariant

-- Half a cent. Named rather than inlined so the guard, the projection and the
-- reconciliation cannot drift apart on it.
create or replace function public.gl_payment_tolerance()
returns numeric language sql immutable
set search_path = public, extensions
as $tol$ select 0.005::numeric $tol$;

-- THE single definition of what an invoice's status should be, given its
-- ledger. Everything else calls this.
--
-- The status CHECK constraint on public.invoices admits only
-- draft / pending / paid / overdue, so those are the only outputs. 'draft' and
-- 'overdue' are preserved when the ledger does not cover the invoice: a draft
-- is not yet owed, and 'overdue' belongs to the nightly job, which this must
-- not fight.
create or replace function public.gl_invoice_derived_status(
  p_amount         numeric,
  p_is_credit_memo boolean,
  p_current_status text,
  p_net            numeric
)
returns text
language sql
immutable
set search_path = public, extensions
as $derived$
  select case
    -- Credit memos are inserted settled and carry a negative amount; the
    -- coverage test is meaningless for them.
    when coalesce(p_is_credit_memo, false)                              then p_current_status
    when p_amount > 0 and p_net >= p_amount - public.gl_payment_tolerance() then 'paid'
    when p_current_status = 'draft'                                     then 'draft'
    when p_current_status = 'overdue'                                   then 'overdue'
    else 'pending'
  end;
$derived$;

-- ------------------------------------------------- projection, now delegating

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

  new_status := public.gl_invoice_derived_status(inv.amount, inv.is_credit_memo, inv.status, net);

  update public.invoices
     set status      = new_status,
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

-- ------------------------------------------------------------------- guard

create or replace function public.gl_guard_invoice_paid_state()
returns trigger
language plpgsql
set search_path = public, extensions
as $guard$
declare
  net            numeric;
  ledger_rows    int;
  expected_status text;
  tol            numeric := public.gl_payment_tolerance();
begin
  -- The early return now covers EVERY column the invariant depends on. The
  -- previous version listed only the five payment columns, so an ordinary edit
  -- to `amount` skipped the check entirely and could leave an invoice paid
  -- without cover, or a ledger larger than the invoice.
  if new.status            is not distinct from old.status
     and new.paid_at           is not distinct from old.paid_at
     and new.paid_amount       is not distinct from old.paid_amount
     and new.paid_method       is not distinct from old.paid_method
     and new.stripe_session_id is not distinct from old.stripe_session_id
     and new.amount            is not distinct from old.amount
     and new.invoice_number    is not distinct from old.invoice_number
     and new.is_credit_memo    is not distinct from old.is_credit_memo then
    return new;
  end if;

  select coalesce(sum(amount), 0), count(*) into net, ledger_rows
    from public.invoice_payments
   where invoice_number = old.invoice_number;

  -- Identity. The ledger is keyed by invoice_number, so renaming an invoice
  -- that has payment events would silently detach them. The foreign key
  -- already refuses this with 23503; saying so plainly is friendlier and
  -- survives the FK being changed.
  if new.invoice_number is distinct from old.invoice_number and ledger_rows > 0 then
    raise exception
      'cannot rename % to %: % payment event(s) are keyed to the current number',
      old.invoice_number, new.invoice_number, ledger_rows
      using errcode = '42501';
  end if;

  -- Classification. Credit memos are exempt from the coverage rules, so
  -- toggling the flag on a row with payment history changes which rules apply.
  if new.is_credit_memo is distinct from old.is_credit_memo and ledger_rows > 0 then
    raise exception
      'cannot change is_credit_memo on % while % payment event(s) exist',
      old.invoice_number, ledger_rows
      using errcode = '42501';
  end if;

  if not coalesce(new.is_credit_memo, false) then
    -- The ledger may never exceed what is owed.
    if new.amount > 0 and net > new.amount + tol then
      raise exception
        'ledger net % exceeds the invoice amount % on %',
        net, new.amount, new.invoice_number
        using errcode = '42501';
    end if;

    -- Status is the projection, in BOTH directions: paid exactly when covered.
    expected_status := public.gl_invoice_derived_status(new.amount, new.is_credit_memo, new.status, net);
    if new.status is distinct from expected_status then
      raise exception
        'status % on % contradicts the ledger: net % against an amount of % projects to %',
        new.status, new.invoice_number, net, new.amount, expected_status
        using errcode = '42501';
    end if;

    -- paid_amount is the net on every relevant update, not only when it moves.
    if new.paid_amount is distinct from greatest(net, 0)
       and not (new.paid_amount is null and net = 0) then
      raise exception
        'paid_amount on % must equal the ledger net of %, not %',
        new.invoice_number, greatest(net, 0), new.paid_amount
        using errcode = '42501';
    end if;

    -- A payment date exists exactly when the invoice is paid.
    if (new.status = 'paid') <> (new.paid_at is not null) then
      raise exception
        'paid_at must be set exactly when % is paid (status=%, paid_at %)',
        new.invoice_number, new.status,
        case when new.paid_at is null then 'null' else 'set' end
        using errcode = '42501';
    end if;
  end if;

  -- Evidence columns must correspond to real events. Previously stripe_session_id
  -- was checked and paid_method was not, while both were described as
  -- ledger-derived.
  if new.paid_method is distinct from old.paid_method
     and new.paid_method is not null
     and not exists (
       select 1 from public.invoice_payments p
        where p.invoice_number = new.invoice_number and p.method = new.paid_method
     ) then
    raise exception
      'paid_method % on % matches no payment event',
      new.paid_method, new.invoice_number
      using errcode = '42501';
  end if;

  if new.stripe_session_id is distinct from old.stripe_session_id
     and new.stripe_session_id is not null
     and not exists (
       select 1 from public.invoice_payments p
        where p.invoice_number = new.invoice_number and p.reference = new.stripe_session_id
     ) then
    raise exception
      'stripe_session_id % on % matches no payment event',
      new.stripe_session_id, new.invoice_number
      using errcode = '42501';
  end if;

  return new;
end
$guard$;

drop trigger if exists invoices_guard_paid_state on public.invoices;
create trigger invoices_guard_paid_state
  before update on public.invoices
  for each row execute function public.gl_guard_invoice_paid_state();

-- ------------------------------------------------------------- reconciliation

-- Re-projects every invoice through gl_invoice_derived_status(), the same
-- function the runtime trigger uses. The previous reconciliation fixed
-- paid_amount and cleared stale evidence but never re-derived status, so a row
-- could satisfy the old checks and fail the new ones.
do $reconcile$
declare
  r    record;
  want text;
begin
  for r in
    select i.invoice_number, i.amount, i.status, i.paid_amount, i.paid_at,
           i.paid_method, i.is_credit_memo,
           coalesce((select sum(p.amount) from public.invoice_payments p
                      where p.invoice_number = i.invoice_number), 0) as net
      from public.invoices i
     where coalesce(i.is_credit_memo, false) = false
  loop
    want := public.gl_invoice_derived_status(r.amount, r.is_credit_memo, r.status, r.net);
    update public.invoices
       set status      = want,
           paid_amount = greatest(r.net, 0),
           paid_at     = case when want = 'paid' then coalesce(r.paid_at, now()) else null end,
           paid_method = case when want = 'paid' then r.paid_method else null end,
           updated_at  = now()
     where invoice_number = r.invoice_number
       and (status is distinct from want
            or paid_amount is distinct from greatest(r.net, 0)
            or (want <> 'paid' and (paid_at is not null or paid_method is not null))
            or (want = 'paid' and paid_at is null));
  end loop;
end
$reconcile$;
