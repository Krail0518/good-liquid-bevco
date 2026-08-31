-- rls-coverage.sql — which unconditional permissive policies have no
-- RESTRICTIVE companion for the same table, command and role?
--
-- WHY THIS SHAPE
-- The repository's deliberate pattern (CLAUDE.md rule 3) is constrain, don't
-- rewrite: ~80 legacy policies say `using (true)` for `authenticated`, and each
-- is ANDed with a RESTRICTIVE guard rather than being rewritten. That is sound
-- ONLY where the guard actually covers the same command and role. The auditor's
-- objection was exact: "policy counts do not prove complete effective
-- coverage." Counting 318 restrictive policies says nothing about whether the
-- right ones line up with the permissive ones.
--
-- So this asks the question directly, per (table, command, role), and returns
-- only the combinations where nothing constrains a `using (true)`.
--
-- TWO THINGS THIS DOES NOT DO, stated so the output is not over-read:
--   * It reads policy TEXT. A permissive policy whose expression is a function
--     call is treated as conditional even if that function returns true. The
--     live probes in scripts/rls-probe.sql are what test behaviour.
--   * `unnest()` twice in one select list ZIPS the arrays and pads with NULLs
--     when their lengths differ, which silently produced null commands in the
--     first version of this query. Hence the lateral joins.
--
-- Emitted one row per uncovered combination, as `table|command|role`, so
-- scripts/check-rls-coverage.sh can diff it against a reviewed allowlist.

with pol as (
  select c.relname as tbl,
         case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                       when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
         p.polpermissive as permissive,
         coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') as using_expr,
         coalesce((select array_agg(r.rolname order by r.rolname)
                     from pg_roles r where r.oid = any(p.polroles)), array['PUBLIC']) as roles
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
),
expanded as (
  select pol.tbl, pol.permissive, pol.using_expr, x.cmd, y.role
    from pol
    cross join lateral unnest(case when pol.cmd = 'ALL'
                 then array['SELECT','INSERT','UPDATE','DELETE']
                 else array[pol.cmd] end) as x(cmd)
    cross join lateral unnest(pol.roles) as y(role)
),
permissive_open as (
  select distinct tbl, cmd, role
    from expanded
   where permissive
     and lower(btrim(using_expr)) = 'true'
     and role in ('authenticated', 'anon', 'PUBLIC')
),
restrictive as (
  select distinct tbl, cmd, role from expanded where not permissive
)
select p.tbl || '|' || p.cmd || '|' || p.role as line
  from permissive_open p
 where not exists (
   select 1 from restrictive r
    where r.tbl = p.tbl
      and r.cmd = p.cmd
      -- A PUBLIC-role permissive policy applies to every role, so any
      -- restrictive policy on that table and command constrains it.
      and (r.role = p.role or p.role = 'PUBLIC')
 )
 order by 1;
