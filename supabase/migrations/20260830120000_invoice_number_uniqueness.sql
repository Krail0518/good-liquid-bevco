-- Allocate invoice numbers server-side, under a lock.
--
-- ROLLBACK:
--   drop function if exists public.gl_next_invoice_number();
--   -- Do NOT drop invoices_invoice_number_key: it predates this migration.
--
-- WHY, AND WHAT THIS IS *NOT*
-- ---------------------------
-- An external audit reported invoice numbering as "race-prone", and I initially
-- read that as "duplicates are possible". Checking production first showed that
-- is already false:
--
--     invoices_invoice_number_key  UNIQUE (invoice_number)
--
-- That constraint exists in the live database. It was not created by any file
-- in supabase/migrations/, which is why a grep of this directory did not find
-- it — a reminder that migrations do not describe production.
--
-- So a duplicate invoice number is already impossible, and the charge path
-- (stripe-checkout-session resolves with invoice_number=eq.<n>&limit=1) cannot
-- be pointed at an ambiguous pair. This migration does NOT add that protection.
--
-- What remains is real but smaller. Two different generators run in the
-- browser:
--
--     invoice-builder.js   'GL-' + (max(loaded numeric part) + 1)
--     crm-index-core.js    'GL-' + year + '-' + Math.floor(Math.random()*9000)
--
-- The first races against another user holding the same loaded list. The second
-- collides by birthday and emits a shape ('GL-2026-4271') that no stored row
-- uses — every one of the 18 live invoices is 'GL-<n>'.
--
-- Either way the constraint turns a collision into a failed save with a
-- constraint-violation message, which is safe but reads to staff as "the app is
-- broken". Allocating the number server-side removes the collision instead of
-- catching it.

-- The advisory lock is transaction-scoped: two concurrent callers serialise
-- here, so each sees the other's committed row before computing its own value.
--
-- The trailing digit group is extracted rather than the whole string parsed, so
-- a legacy 'GL-<year>-<n>' row cannot make max() jump to the year.
create or replace function public.gl_next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_n bigint;
begin
  -- SECURITY DEFINER, so it must gate itself. Without this any authenticated
  -- caller could probe how many invoices exist.
  if not public.is_gl_staff() then
    raise exception 'not authorised';
  end if;

  perform pg_advisory_xact_lock(hashtext('gl_invoice_number'));

  select coalesce(
           max((regexp_match(invoice_number, '([0-9]+)$'))[1]::bigint),
           1000
         ) + 1
    into next_n
  from public.invoices
  where invoice_number ~ '[0-9]+$';

  return 'GL-' || next_n;
end;
$$;

revoke all on function public.gl_next_invoice_number() from public, anon;
grant execute on function public.gl_next_invoice_number() to authenticated;

comment on function public.gl_next_invoice_number() is
  'Allocates the next GL-<n> invoice number under a transaction advisory lock. '
  'Staff only. The pre-existing unique constraint on invoices.invoice_number '
  'remains the backstop; this removes the race rather than catching it.';
