-- ROLLBACK:
--   do $$
--   declare t text;
--   begin
--     foreach t in array array[
--       'ai_briefs','attention_snoozes','bottling_rates','canning_rates','capacity',
--       'client_artwork','clients','company_docs','deals','gmp_documents','gmp_templates',
--       'invoices','onboarding','pricing_settings','product_intake','qbo_tokens','quotes',
--       'referrals','sales_decks','tasks','user_permissions']
--     loop
--       execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
--     end loop;
--   end $$;
--
--   Reverting restores the previous behaviour exactly: updated_at simply stops
--   being maintained again. No data is lost either way — the column keeps
--   whatever value it last held.
--
-- GL-049 — updated_at was not maintained on 21 tables.
--
-- WHAT WAS WRONG
-- 42 public tables carry an updated_at column. Twenty of them are wired to
-- public.set_updated_at() via a before-update trigger; twenty-one were never
-- wired to anything, so the column only ever changed if application code
-- happened to set it by hand. Most write paths do not.
--
-- The result is a column that looks authoritative and is not. Observed on
-- 2026-08-30: invoice GL-1024 went from 'pending' to 'paid' while its
-- updated_at stayed frozen at a timestamp two hours older, and GL-1015 changed
-- status while still reading 13 July. Both were verified against the live
-- database, not inferred.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
-- Nothing breaks loudly. Everything downstream that asks "when did this last
-- change" — delta syncs, recently-changed views, an auditor asking when an
-- invoice was altered — gets a confident, wrong answer. On invoices, clients
-- and quotes that is a financial audit trail. It also cost real time: while
-- verifying an unrelated fix, updated_at was read as evidence that no write had
-- occurred, and it took a realtime notification firing to prove otherwise.
--
-- WHAT THIS DOES
-- Attaches the EXISTING public.set_updated_at() to the twenty-one tables that
-- lack it, using the same trigger shape and naming as the twenty that already
-- have it. No new function, no behaviour invented — this closes a gap in a
-- convention the schema already had.
--
-- ON OVERRIDING CALLERS
-- A handful of modules already set updated_at explicitly, from the BROWSER's
-- clock (new Date().toISOString() in invoice-patches.js, pricing-settings.js,
-- deal-brief.js and others). The trigger overwrites those with server now(),
-- which is the intended outcome: a client clock is not a trustworthy source for
-- an audit timestamp, and those values were only ever approximately "now"
-- anyway. Nothing in the codebase sets updated_at to a deliberate historical
-- value, which was checked before writing this.
--
-- SAFETY
-- Idempotent: skips any table that already has a trigger running
-- set_updated_at, so re-running changes nothing. Skips tables that do not exist
-- or lack the column rather than failing the whole migration. Row-level
-- security is unaffected — this fires inside the write RLS already permitted,
-- and set_updated_at is NOT security definer, so it cannot widen anyone's
-- access.

do $$
declare
  t          text;
  trg_name   text;
  has_col    boolean;
  has_trg    boolean;
  created    int := 0;
  skipped    int := 0;
begin
  foreach t in array array[
    'ai_briefs','attention_snoozes','bottling_rates','canning_rates','capacity',
    'client_artwork','clients','company_docs','deals','gmp_documents','gmp_templates',
    'invoices','onboarding','pricing_settings','product_intake','qbo_tokens','quotes',
    'referrals','sales_decks','tasks','user_permissions'
  ]
  loop
    -- The table must exist AND actually have the column. A missing table is a
    -- skip, not a failure: this list is a snapshot of one moment in the schema.
    select exists (
      select 1
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
      where c.table_schema = 'public'
        and c.table_name = t
        and c.column_name = 'updated_at'
        and tb.table_type = 'BASE TABLE'
    ) into has_col;

    if not has_col then
      skipped := skipped + 1;
      raise notice 'skip %: no updated_at column (or no such table)', t;
      continue;
    end if;

    trg_name := 'trg_' || t || '_updated_at';

    -- Skip if the column is already maintained, OR if a trigger of the name
    -- this would use already exists.
    --
    -- The name check is not belt-and-braces. Checking only for a trigger that
    -- runs set_updated_at was not enough: replaying this history from scratch
    -- creates trg_quotes_updated_at earlier, bound to a DIFFERENT function, and
    -- this then failed with "trigger already exists". Production never hit it
    -- because production's state and a from-scratch rebuild are not the same
    -- thing — which is the entire lesson of GL-055.
    select exists (
      select 1
      from pg_trigger tg
      join pg_class cl on cl.oid = tg.tgrelid
      join pg_namespace n on n.oid = cl.relnamespace
      left join pg_proc p on p.oid = tg.tgfoid
      where n.nspname = 'public'
        and cl.relname = t
        and not tg.tgisinternal
        and (p.proname = 'set_updated_at' or tg.tgname = trg_name)
    ) into has_trg;

    if has_trg then
      skipped := skipped + 1;
      continue;
    end if;

    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      trg_name, t);
    created := created + 1;
  end loop;

  raise notice 'GL-049: % trigger(s) created, % skipped', created, skipped;
end $$;
