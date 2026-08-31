-- schema-fingerprint.sql — a per-category fingerprint of the public schema.
--
-- Run against two databases and compare. Equal counts AND equal hashes for a
-- category mean the two agree on every object in it; a differing hash with an
-- equal count means the objects differ in content, which is the case that a
-- count-only comparison misses.
--
-- WHAT THIS IS FOR
-- The external auditor's definition-of-done item 7: "A clean migration replay
-- and an upgrade replay produce the same schema, policies, grants, and
-- functions." Proving that needs an object-level comparison, not a table count.
--
-- ONE LESSON ALREADY LEARNED HERE, kept in the query shape:
-- the trigger category includes the FUNCTION each trigger is bound to. An
-- earlier version hashed only (table, trigger name) and reported triggers as
-- identical while production and a clean replay had trg_quotes_updated_at bound
-- to two DIFFERENT functions. A fingerprint that omits the thing that varies
-- reports agreement it has not checked.
--
--   psql "$PROD_URL"    -f scripts/schema-fingerprint.sql
--   psql "$STAGING_URL" -f scripts/schema-fingerprint.sql
--   # then diff the two outputs

with
tables as (
  select string_agg(c.relname,'|' order by c.relname) v, count(*) n
    from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relkind='r'),
cols as (
  select string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-'),'|'
         order by table_name, column_name) v, count(*) n
    from information_schema.columns where table_schema='public'),
cons as (
  select string_agg(c.conrelid::regclass::text||':'||c.conname||':'||pg_get_constraintdef(c.oid),'|'
         order by c.conrelid::regclass::text, c.conname) v, count(*) n
    from pg_constraint c join pg_namespace s on s.oid=c.connamespace where s.nspname='public'),
idx as (
  select string_agg(indexname||':'||indexdef,'|' order by indexname) v, count(*) n
    from pg_indexes where schemaname='public'),
trg as (
  -- Includes the bound function. See the note above.
  select string_agg(c.relname||':'||t.tgname||':'||p.proname,'|' order by c.relname, t.tgname) v, count(*) n
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and not t.tgisinternal),
fns as (
  -- Includes prosecdef. SECURITY DEFINER is the difference between a function
  -- that runs as the caller and one that runs as the owner, and a fingerprint
  -- that ignores it would have missed six of them here.
  select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||p.prosecdef::text,'|'
         order by p.proname, pg_get_function_identity_arguments(p.oid)) v, count(*) n
    from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'),
rls as (
  select string_agg(c.relname||':'||c.relrowsecurity::text,'|' order by c.relname) v, count(*) n
    from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r'),
pol as (
  select string_agg(c.relname||':'||p.polname||':'||p.polcmd::text||':'||p.polpermissive::text,'|'
         order by c.relname, p.polname) v, count(*) n
    from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace s on s.oid=c.relnamespace where s.nspname='public'),
grants as (
  select string_agg(table_name||':'||grantee||':'||privilege_type,'|'
         order by table_name, grantee, privilege_type) v, count(*) n
    from information_schema.role_table_grants where table_schema='public')
select 'tables' k, n, md5(coalesce(v,'')) h from tables
union all select 'columns',        n, md5(coalesce(v,'')) from cols
union all select 'constraints',    n, md5(coalesce(v,'')) from cons
union all select 'indexes',        n, md5(coalesce(v,'')) from idx
union all select 'triggers',       n, md5(coalesce(v,'')) from trg
union all select 'functions',      n, md5(coalesce(v,'')) from fns
union all select 'rls_flags',      n, md5(coalesce(v,'')) from rls
union all select 'policies',       n, md5(coalesce(v,'')) from pol
union all select 'grants',         n, md5(coalesce(v,'')) from grants
order by 1;
