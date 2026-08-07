-- ════════════════════════════════════════════════════════════════
-- Least-privilege EXECUTE on SECURITY DEFINER functions
-- ════════════════════════════════════════════════════════════════
-- Supabase's security advisor flags every SECURITY DEFINER function the
-- anon / authenticated roles can call over /rest/v1/rpc. None was
-- exploitable — each authorises internally — but a definer function
-- reachable by a role with no business calling it is needless attack
-- surface, and trigger functions should not be RPC-callable at all.
--
-- NOTE: revoking from `anon` alone does nothing, because functions carry
-- an implicit EXECUTE grant to PUBLIC that anon inherits. The revoke has
-- to name PUBLIC, then re-grant to the roles that genuinely need it.
--
-- Kept callable by anon (this IS the public surface):
--   get_shared_invoice, get_shared_allergen_declaration, gl_onboarding_get,
--   gl_onboarding_submit, get_page_blocked_slots, submit_quote_request,
--   plus is_valid_inspector_token / current_inspector_token, which anon
--   RLS policies evaluate directly.
--
-- Service-role-only secrets (gl_secret_get/set, gl_check_cron_secret)
-- already lack an authenticated grant and must keep it that way, so the
-- re-grant below is conditional on what each function had beforehand.
--
-- ROLLBACK: grant execute on function public.<name>(<args>) to anon, authenticated;

-- ── Trigger functions: not callable as RPCs by anyone ──────────────
-- (Triggers fire in the table owner's context, so this cannot break them.)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ── Everything else: drop the PUBLIC/anon grant, keep what was there ──
do $$
declare
  f record;
  keep_auth boolean;
  public_fns text[] := array[
    'get_shared_invoice', 'get_shared_allergen_declaration',
    'gl_onboarding_get', 'gl_onboarding_submit', 'get_page_blocked_slots',
    'submit_quote_request', 'is_valid_inspector_token', 'current_inspector_token'
  ];
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
  loop
    -- Preserve pre-existing authenticated access rather than assuming it.
    keep_auth := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    execute format('revoke all on function %s from public, anon', f.sig);
    if keep_auth then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname = any(public_fns) then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;

-- ── Pin the last two mutable search_paths ─────────────────────────
alter function public.set_updated_at()          set search_path = public, pg_temp;
alter function public.current_inspector_token() set search_path = public, pg_temp;

notify pgrst, 'reload schema';
