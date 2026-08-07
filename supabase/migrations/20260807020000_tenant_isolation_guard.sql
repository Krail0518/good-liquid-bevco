-- ════════════════════════════════════════════════════════════════
-- Tenant isolation guard — stop "any logged-in user sees everything"
-- ════════════════════════════════════════════════════════════════
-- Found by the 2026-08-06 audit. ~33 tables carry legacy permissive
-- policies like `authed all` / `Authenticated can read X`
-- (USING true, or auth.role() = 'authenticated'). Because permissive
-- policies are OR'd, those defeat every carefully scoped policy next to
-- them. Measured before this migration, portal customer Serge
-- (Patizan Energy) could read ALL 6 clients and ALL 18 invoices —
-- i.e. one client could read another client's invoices and formulas.
--
-- Worse, `is_staff_user()` returns TRUE for any authenticated user that
-- has no customer_users row, and Supabase signup is open — so anyone
-- who registered an account was treated as staff by the DB.
--
-- Rather than rewrite ~80 legacy policies (high risk of locking out the
-- CRM), this adds ONE RESTRICTIVE policy per table. Restrictive policies
-- are AND-ed with the permissive ones, so:
--   • real staff (an active public.profiles row) — unchanged, full access
--   • portal customers — confined to their own client's rows
--   • a self-registered account with neither — sees nothing
--   • anon — unaffected here (governed by 20260807010000); inspector
--     token links still work because this policy targets `authenticated`
--   • edge functions use service_role, which bypasses RLS entirely
--
-- ROLLBACK: drop policy "gl tenant guard" on public.<table>;

-- Staff identity that does NOT have the is_staff_user() fallback:
-- membership is an active profiles row, nothing else.
create or replace function public.is_gl_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and coalesce(p.status, 'active') <> 'inactive'
  );
$$;
grant execute on function public.is_gl_staff() to authenticated;

do $$
declare
  t text;
  -- Tables a portal customer legitimately reads/writes, scoped by client_id.
  customer_scoped text[] := array[
    'client_allergen_declarations','client_artwork','customer_requests',
    'customer_users','deal_documents','formulas','invoices','lot_documents',
    'production_runs','sample_shipments'
  ];
  -- Staff-only business tables: portal customers get nothing.
  staff_only text[] := array[
    'activity','activity_feed','announcements','audit_findings','audit_log',
    'bookings','cal_events','cip_equipment','cip_logs','client_notes',
    'client_rate_overrides','client_tags','company_docs','compliance_acks',
    'compliance_records','compliance_tasks','contact_submissions',
    'content_calendar','deal_activity','deals','defects','documents',
    'email_log','email_schedule','email_templates','error_log','expenses',
    'facilities','followup_log','gmp_documents','gmp_task_defs','gmp_templates',
    'hold_tags','inspector_tokens','internal_audits','inventory',
    'invoice_payments','lot_inputs','lot_shipments','management_reviews',
    'mock_recalls','notifications','nps_responses','onboarding',
    'permissions_audit','production_lines','production_pipeline','profiles',
    'qbo_tokens','quotes','recurring_invoices','referrals','referrers','tasks',
    'time_entries','trade_shows','training_records','user_permissions','vendors',
    'yield_logs'
  ];
begin
  foreach t in array customer_scoped loop
    execute format('drop policy if exists "gl tenant guard" on public.%I', t);
    execute format(
      'create policy "gl tenant guard" on public.%I as restrictive to authenticated '
      -- ::text on both sides: client_id is uuid on most tables but text on
      -- formulas, and an uncast comparison errors at policy-creation time.
      || 'using (public.is_gl_staff() or client_id::text = public.current_customer_client_id()::text)', t);
  end loop;

  foreach t in array staff_only loop
    execute format('drop policy if exists "gl tenant guard" on public.%I', t);
    execute format(
      'create policy "gl tenant guard" on public.%I as restrictive to authenticated '
      || 'using (public.is_gl_staff())', t);
  end loop;

  -- clients keys on id, not client_id.
  execute 'drop policy if exists "gl tenant guard" on public.clients';
  execute 'create policy "gl tenant guard" on public.clients as restrictive to authenticated '
       || 'using (public.is_gl_staff() or id::text = public.current_customer_client_id()::text)';
end $$;

-- Deliberately NOT guarded (shared/public reference data, or needed by the
-- portal outside client scope): app_settings, permission_components,
-- login_events, capacity, case_studies, resources, booking_pages,
-- bottling_rates, canning_rates.

notify pgrst, 'reload schema';
