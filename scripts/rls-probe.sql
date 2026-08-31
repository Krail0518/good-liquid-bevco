-- rls-probe.sql — what each identity can actually do, tested rather than argued.
--
-- scripts/check-rls-coverage.sh reads policy TEXT and proves that every
-- unconditional permissive policy is ANDed with a restrictive guard. That is a
-- structural argument. This is the behavioural one: it assumes an identity and
-- tries the operation.
--
-- Both are needed and neither substitutes for the other. A policy set can look
-- correct and behave wrongly (a guard function returning true for the wrong
-- caller), and it can look wrong and behave correctly -- `formulators` and
-- `sales_decks` are exactly that: the structural query flags them as uncovered
-- because it pairs policies by command, and the probe shows a stranger is
-- refused 42501 anyway.
--
-- SAFE AGAINST PRODUCTION: everything runs inside a transaction that ROLLS
-- BACK, and identities are simulated with set_config rather than created. No
-- auth.users row is inserted and no account exists afterwards.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rls-probe.sql
--
-- IDENTITIES COVERED HERE
--   anon      the publishable key, signed out
--   stranger  the authenticated role holding a uuid with NO profiles row.
--             Supabase signup is open, so this is what a real attacker has.
--
-- NOT COVERED HERE: staff, admin, super, inactive, and portal owner/member.
-- Each needs a profiles or customer_users row, which needs an auth.users row to
-- satisfy a foreign key. This script will not create an account in production,
-- even inside a rollback. Run those against staging, where the fixture exists.
--
-- TWO MISTAKES THIS FILE HAS ALREADY MADE, both the same kind -- a probe that
-- cannot tell its own plumbing failing from the thing it is testing:
--
--   * A `serial` column carries its own sequence. A role that may INSERT but
--     not USE the sequence fails with 42501 on the SEQUENCE, which is
--     indistinguishable from an RLS refusal inside `exception when others` and
--     was scored as a PASS. There is no serial here; ordering is by
--     clock_timestamp().
--   * `insert into invoice_payments ... select invoice_number from invoices
--     limit 1` inserted ZERO rows for a stranger, because a stranger reads zero
--     rows from invoices. No exception, nothing inserted, and the probe
--     recorded "INSERTED" -- reporting a vulnerability that did not exist. The
--     target is now captured as a literal BEFORE the role switch, and every
--     write checks its row count.

\set ON_ERROR_STOP on
begin;

create temporary table probe(
  at       timestamptz,
  identity text,
  tbl      text,
  cmd      text,
  observed text,
  verdict  text
);

-- Captured as the owner, before any role switch, so the write probe below
-- attempts a row that really exists.
create temporary table probe_fixture(invnum text);
insert into probe_fixture select invoice_number from public.invoices limit 1;

grant all on probe to anon, authenticated;
grant select on probe_fixture to anon, authenticated;

-- ─────────────────────────────────────────────── anon: the publishable key
set local role anon;

do $anon$
declare n int;
begin
  -- The tables whose exposure is the worst outcome this system can produce.
  begin select count(*) into n from public.clients;
    insert into probe values (clock_timestamp(),'anon','clients','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'anon','clients','SELECT','refused '||sqlstate,'PASS'); end;

  begin select count(*) into n from public.invoices;
    insert into probe values (clock_timestamp(),'anon','invoices','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'anon','invoices','SELECT','refused '||sqlstate,'PASS'); end;

  begin select count(*) into n from public.formulas;
    insert into probe values (clock_timestamp(),'anon','formulas','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'anon','formulas','SELECT','refused '||sqlstate,'PASS'); end;

  begin select count(*) into n from public.invoice_payments;
    insert into probe values (clock_timestamp(),'anon','invoice_payments','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'anon','invoice_payments','SELECT','refused '||sqlstate,'PASS'); end;

  -- The allowlisted public read SHOULD work. If this starts failing, the
  -- marketing site broke and nobody noticed.
  begin select count(*) into n from public.capacity;
    insert into probe values (clock_timestamp(),'anon','capacity','SELECT',n||' rows', case when n>0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'anon','capacity','SELECT','refused '||sqlstate,'FAIL'); end;
end
$anon$;

-- ───────────────────────────── stranger: authenticated, with no staff profile
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000deadbeef","role":"authenticated"}';

do $stranger$
declare n int; inv text;
begin
  insert into probe values (clock_timestamp(),'stranger','-','context',
    'is_gl_staff='||public.is_gl_staff()::text,
    case when public.is_gl_staff() then 'FAIL' else 'PASS' end);

  begin select count(*) into n from public.clients;
    insert into probe values (clock_timestamp(),'stranger','clients','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','clients','SELECT','refused '||sqlstate,'PASS'); end;

  begin select count(*) into n from public.invoices;
    insert into probe values (clock_timestamp(),'stranger','invoices','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','invoices','SELECT','refused '||sqlstate,'PASS'); end;

  begin select count(*) into n from public.formulas;
    insert into probe values (clock_timestamp(),'stranger','formulas','SELECT',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','formulas','SELECT','refused '||sqlstate,'PASS'); end;

  begin insert into public.clients (name) values ('rls-probe');
    get diagnostics n = row_count;
    insert into probe values (clock_timestamp(),'stranger','clients','INSERT',n||' row(s)', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','clients','INSERT','refused '||sqlstate,'PASS'); end;

  begin update public.invoices set notes='rls-probe' where true;
    get diagnostics n = row_count;
    insert into probe values (clock_timestamp(),'stranger','invoices','UPDATE',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','invoices','UPDATE','refused '||sqlstate,'PASS'); end;

  begin delete from public.clients where true;
    get diagnostics n = row_count;
    insert into probe values (clock_timestamp(),'stranger','clients','DELETE',n||' rows', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','clients','DELETE','refused '||sqlstate,'PASS'); end;

  -- The ledger is now the authority on whether an invoice is paid, so "can a
  -- stranger insert a ledger row" is this design's version of "can a stranger
  -- mark an invoice paid".
  select invnum into inv from probe_fixture;
  insert into probe values (clock_timestamp(),'stranger','-','fixture',
    'target invoice = '||coalesce(inv,'NONE'), case when inv is null then 'FAIL' else 'PASS' end);

  begin
    insert into public.invoice_payments (invoice_number, amount, method, paid_at)
    values (inv, 1, 'Cash', current_date);
    get diagnostics n = row_count;
    insert into probe values (clock_timestamp(),'stranger','invoice_payments','INSERT',
      n||' row(s) inserted', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then
    insert into probe values (clock_timestamp(),'stranger','invoice_payments','INSERT','refused '||sqlstate,'PASS');
  end;

  -- The two combinations the structural query flags as uncovered but which are
  -- constrained in practice. If either ever succeeds, the allowlist entry is
  -- wrong and must be removed rather than re-justified.
  begin insert into public.formulators (name) values ('rls-probe');
    get diagnostics n = row_count;
    insert into probe values (clock_timestamp(),'stranger','formulators','INSERT',n||' row(s)', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','formulators','INSERT','refused '||sqlstate,'PASS'); end;

  begin insert into public.sales_decks (key,label,filename,storage_path) values ('rls-probe','P','p.pdf','p/p.pdf');
    get diagnostics n = row_count;
    insert into probe values (clock_timestamp(),'stranger','sales_decks','INSERT',n||' row(s)', case when n=0 then 'PASS' else 'FAIL' end);
  exception when others then insert into probe values (clock_timestamp(),'stranger','sales_decks','INSERT','refused '||sqlstate,'PASS'); end;
end
$stranger$;

reset role;
select verdict, identity, tbl, cmd, observed from probe order by at;

do $verdict$
declare bad int;
begin
  select count(*) into bad from probe where verdict <> 'PASS';
  if bad > 0 then raise exception '% RLS probe(s) FAILED', bad; end if;
  raise notice 'RLS probes: all passed';
end
$verdict$;

rollback;
