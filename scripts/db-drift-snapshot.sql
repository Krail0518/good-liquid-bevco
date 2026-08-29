-- db-drift-snapshot.sql — one canonical, ordered line per authorization fact.
--
-- WHY THIS EXISTS
-- ---------------
-- Reading the repository cannot tell you who can do what in production. The
-- 2026-05-18 incident happened because fourteen permissive anon policies were
-- applied by hand in the Supabase dashboard and therefore appeared in NO
-- migration; code review could not have found them. The same shape recurred
-- twice more in this audit: `authed all` / `anon read` / `public read` policies
-- on thirteen tables that exist in no migration, and blanket write grants to
-- anon on seventy-three tables.
--
-- Every one of those was found by querying the live catalog. So the catalog is
-- what has to be diffed, not the migrations.
--
-- OUTPUT CONTRACT
-- One text column named `line`. Stable ordering, no timestamps, no row counts,
-- nothing that changes between identical databases — so a diff shows only real
-- authorization changes and never noise.
--
-- Covers what the independent audit asked for:
--   policies (public + storage), RLS enablement, anon/authenticated table
--   grants, and function security mode / search_path / ACL.
-- Edge Function verify_jwt is checked separately in check-db-drift.sh, because
-- it comes from the Management API rather than the database.

with policies as (
  select format('POLICY   %s.%s | %s | %s | %s | %s | using=%s | check=%s',
           schemaname, tablename, policyname, permissive, roles::text, cmd,
           coalesce(qual, '-'), coalesce(with_check, '-')) as line
    from pg_policies
   where schemaname in ('public', 'storage')
),
rls as (
  select format('RLS      public.%s | enabled=%s', c.relname, c.relrowsecurity) as line
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
grants as (
  -- Grouped so one line per table+role, not one per privilege. A privilege
  -- appearing or disappearing changes that line.
  select format('GRANT    public.%s | %s | %s',
           table_name, grantee,
           string_agg(privilege_type, ',' order by privilege_type)) as line
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
   group by table_name, grantee
),
funcs as (
  -- prosecdef, search_path and the ACL together decide whether a function is
  -- a privilege-escalation path. gl_send_quote_decks was SECURITY DEFINER,
  -- EXECUTE-able by authenticated, and read a Vault secret with no authz check.
  select format('FUNC     public.%s(%s) | secdef=%s | %s | acl=%s',
           p.proname,
           pg_get_function_identity_arguments(p.oid),
           p.prosecdef,
           coalesce((select string_agg(cfg, ',') from unnest(p.proconfig) cfg
                      where cfg like 'search_path%'), 'search_path=UNSET'),
           coalesce(array_to_string(p.proacl, ','), 'default(PUBLIC)')) as line
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
buckets as (
  select format('BUCKET   %s | public=%s', id, public) as line
    from storage.buckets
)
select line
  from (
    select line from policies
    union all select line from rls
    union all select line from grants
    union all select line from funcs
    union all select line from buckets
  ) all_facts
 order by line;
