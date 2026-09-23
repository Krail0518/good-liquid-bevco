-- Undo ONE mis-keyed payment, not the whole invoice (GL-126)
--
-- gl_reverse_invoice_payments already existed, but it reverses the entire net
-- — it is what "Mark unpaid" calls. With partial payments that is the wrong
-- tool: typing 2500 as 25000 on the second of three payments should undo that
-- one line, not wipe the other two.
--
-- The ledger is append-only and means it: invoice_payments_immutable blocks
-- UPDATE and DELETE outright. So an undo is a compensating negative row, which
-- is also the honest accounting — the mistake and its correction both stay on
-- the record, with who did it and why.
--
-- Guards, in order of how likely they are to matter:
--   * staff only, like every sibling function.
--   * a Stripe payment is refused. Money that moved through Stripe has to be
--     refunded through Stripe or the two ledgers disagree; GL-119/GL-120 built
--     that path and this must not offer a way around it.
--   * reversing a reversal is refused — that is an accident, not an intent.
--   * double-reversal is impossible rather than merely discouraged: the
--     compensating row carries provider_event_id = 'reversal:<payment id>',
--     and invoice_payments_provider_event_key is UNIQUE on
--     (provider, provider_event_id). A second attempt hits the index, which is
--     caught and reported as already_reversed. Two admins clicking at once get
--     one reversal, not two.
--   * gl_enforce_ledger_bounds (BEFORE INSERT) already refuses anything that
--     would take the invoice's net below zero, holding the invoice lock while
--     it checks. That covers reversing a payment whose invoice was separately
--     zeroed out, so it is not re-implemented here.
--
-- Which of those last two fires depends on the invoice, and both were checked
-- against the live database: BEFORE INSERT triggers run ahead of index checks,
-- so when the second attempt would also overdraw the ledger the answer is
-- would_overdraw, and when other payments leave enough net to absorb it the
-- answer is already_reversed. Either way there is exactly one reversal.
--
-- The AFTER INSERT trigger re-derives the invoice: a reversal that drops the
-- net below the total flips 'paid' back to 'partial' (or 'pending' at zero)
-- and clears paid_at, with no extra work here.
--
-- ROLLBACK: drop function public.gl_reverse_one_payment(uuid, text);

begin;

create or replace function public.gl_reverse_one_payment(
  p_payment_id uuid,
  p_reason     text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare pay public.invoice_payments%rowtype; inv public.invoices%rowtype;
begin
  if not public.is_gl_staff() then raise exception 'staff only' using errcode='42501'; end if;

  select * into pay from public.invoice_payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'unknown_payment');
  end if;

  if pay.event_kind = 'reversal' then
    return jsonb_build_object('applied', false, 'reason', 'already_a_reversal');
  end if;

  if coalesce(pay.provider, '') = 'stripe' then
    return jsonb_build_object('applied', false, 'reason', 'stripe_payment',
      'detail', 'Refund this through Stripe so both records agree.');
  end if;

  begin
    insert into public.invoice_payments
      (invoice_number, amount, method, paid_at, reference,
       provider, provider_event_id, currency, event_kind, created_by)
    values
      (pay.invoice_number, -pay.amount, pay.method, current_date,
       coalesce(nullif(btrim(p_reason), ''), 'Payment entered in error')
         || ' (undo of ' || to_char(pay.paid_at, 'YYYY-MM-DD')
         || ' ' || pay.method || ')',
       'manual', 'reversal:' || pay.id::text, coalesce(pay.currency, 'usd'),
       'reversal', auth.uid());
  exception
    when unique_violation then
      return jsonb_build_object('applied', false, 'reason', 'already_reversed',
        'invoice_number', pay.invoice_number);
    when check_violation then
      -- gl_enforce_ledger_bounds: the invoice's net would go negative.
      return jsonb_build_object('applied', false, 'reason', 'would_overdraw',
        'invoice_number', pay.invoice_number,
        'paid_total', public.gl_ledger_net(pay.invoice_number));
  end;

  select * into inv from public.invoices where invoice_number = pay.invoice_number;
  return jsonb_build_object(
    'applied', true, 'reason', 'reversed',
    'invoice_number', pay.invoice_number,
    'reversed_amount', pay.amount,
    'paid_total', public.gl_ledger_net(pay.invoice_number),
    'status', inv.status);
end
$function$;

revoke all on function public.gl_reverse_one_payment(uuid, text) from public, anon;
grant execute on function public.gl_reverse_one_payment(uuid, text) to authenticated;

commit;
