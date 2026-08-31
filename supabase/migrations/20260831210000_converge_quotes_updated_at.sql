-- Make the quotes updated_at trigger converge, whichever path got you here.
--
-- FOUND BY THE UPGRADE REPLAY (auditor item D)
-- Comparing production against a database built by replaying the whole
-- migration history turned up one behavioural divergence:
--
--   production  trg_quotes_updated_at -> public.set_updated_at()
--               public.set_quotes_updated_at() does not exist
--   clean replay  trg_quotes_updated_at -> public.set_quotes_updated_at()
--
-- Both functions have the same body -- `new.updated_at = now()` -- so the
-- observable behaviour is identical and nothing is broken either way. It is
-- still a divergence, and the whole point of an upgrade replay is that "the
-- same migrations produced two different schemas" is a fact worth knowing
-- before it matters.
--
-- WHY IT HAPPENED
-- 20260713000000_quotes_table.sql creates a bespoke set_quotes_updated_at() and
-- binds the trigger to it. GL-049 (20260830210000) later attaches the shared
-- set_updated_at() to twenty-one tables, and SKIPS any table that already has a
-- trigger of the name it would use. On a clean replay the bespoke trigger
-- exists by then, so GL-049 skips quotes and the bespoke binding survives. In
-- production the trigger was already bound to the shared function before GL-049
-- ran, so there was nothing to skip and nothing to change.
--
-- That skip is not a bug -- without it a clean replay fails outright with
-- "trigger already exists", which is why it was added. But "skip" and
-- "converge" are different, and the migration chose the first.
--
-- WHAT THIS DOES
-- Rebinds the trigger to the shared function and drops the bespoke one, on
-- whichever database it runs against. Production is already in the target
-- state, so this is a no-op there; a clean replay lands in the same place. Both
-- paths now agree.
--
-- ROLLBACK:
--   create or replace function public.set_quotes_updated_at()
--   returns trigger language plpgsql as $$
--   begin new.updated_at = now(); return new; end $$;
--   drop trigger if exists trg_quotes_updated_at on public.quotes;
--   create trigger trg_quotes_updated_at before update on public.quotes
--     for each row execute function public.set_quotes_updated_at();
--   -- Reverting restores the divergence, not a behaviour change: both
--   -- functions do the same thing.

set search_path = public, extensions;

do $converge$
begin
  if to_regclass('public.quotes') is null then
    raise notice 'no public.quotes table — nothing to converge';
    return;
  end if;

  -- Rebind first, so the drop below cannot fail on a dependency.
  drop trigger if exists trg_quotes_updated_at on public.quotes;
  create trigger trg_quotes_updated_at
    before update on public.quotes
    for each row execute function public.set_updated_at();

  -- Only now is the bespoke function unreferenced. `if exists` because
  -- production dropped it at some point already.
  drop function if exists public.set_quotes_updated_at();

  raise notice 'quotes.updated_at now maintained by the shared set_updated_at()';
end
$converge$;
