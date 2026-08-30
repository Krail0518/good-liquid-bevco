-- ============================================================
-- Lock destructive ops on the remaining operational tables
-- ============================================================
-- Final sweep after #34 / #35 covered the catastrophic-loss tables.
-- These are lower-priority but still benefit from super-only DELETE:
--
--   • deals             — sales pipeline (rebuilding from scratch hurts)
--   • content_calendar  — published content schedule
--   • case_studies      — marketing IP
--   • trade_shows       — historical event ROI tracking
--   • nps_responses     — customer feedback / sentiment trail
--   • resources         — sales collateral library
--
-- Pattern matches #35: drop the wide-open `for all to authenticated`
-- policy, replace with explicit per-verb (staff for read/write,
-- super for delete).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Reusable: same shape for each table
do $$
declare
  v_tables text[] := array['deals','content_calendar','case_studies','trade_shows','nps_responses','resources'];
  v_table  text;
begin
  foreach v_table in array v_tables loop
    -- Skip if table doesn't exist (defensive)
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=v_table and c.relkind='r') then
      continue;
    end if;
    -- Drop all known policy names (idempotent on re-run)
    execute format('drop policy if exists %I on public.%I', v_table || ' authed', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || ' authed staff', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || ' staff all', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || ' staff select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || ' staff insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || ' staff update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || ' super delete', v_table);
    -- Re-install the canonical four-verb split
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff_user())',
                   v_table || ' staff select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff_user())',
                   v_table || ' staff insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user())',
                   v_table || ' staff update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_super_user())',
                   v_table || ' super delete', v_table);
  end loop;
end $$;

notify pgrst, 'reload schema';
