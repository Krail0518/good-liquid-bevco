-- ════════════════════════════════════════════════════════════════
-- Client portal v2 (5a/5) — take EXECUTE off the trigger functions
-- ════════════════════════════════════════════════════════════════
-- Migrations 1, 2 and 5 each ended their function definitions with
--
--     revoke all on function public.<fn>() from public, anon;
--
-- which is not enough on Supabase. PUBLIC and anon are not the only grantees:
-- the project's default privileges also grant EXECUTE to `authenticated`, so
-- every one of these SECURITY DEFINER functions was reachable by any signed-in
-- user at /rest/v1/rpc/<fn>. Supabase's own database linter flagged all six
-- (lint 0029) minutes after the migrations were applied.
--
-- The practical risk is low -- a trigger function invoked outside a trigger
-- raises `trigger functions can only be called as triggers`, and
-- gl_audit_actor_email() returns only the caller's own email -- but "low" is
-- not the standard here. A SECURITY DEFINER function runs as its owner; none of
-- these should be callable by anyone, ever, because a trigger does not need
-- EXECUTE to fire.
--
-- The three functions that ARE meant to be called keep their grant:
-- gl_portal_entitlements(), gl_portal_formula_status(), gl_can_read_formula().
--
-- ROLLBACK:
--   grant execute on function public.gl_audit_actor_email() to authenticated;
--   grant execute on function public.gl_audit_milestone() to authenticated;
--   grant execute on function public.gl_audit_entitlement() to authenticated;
--   grant execute on function public.gl_audit_document_visibility() to authenticated;
--   grant execute on function public.gl_audit_artwork_project() to authenticated;
--   grant execute on function public.gl_stamp_project_milestones() to authenticated;
--   Reverting re-exposes six SECURITY DEFINER functions over the REST API for
--   no benefit; the triggers that call them are unaffected either way.

set search_path = public, extensions;

revoke all on function public.gl_audit_actor_email()            from authenticated;
revoke all on function public.gl_audit_milestone()              from authenticated;
revoke all on function public.gl_audit_entitlement()            from authenticated;
revoke all on function public.gl_audit_document_visibility()    from authenticated;
revoke all on function public.gl_audit_artwork_project()        from authenticated;
revoke all on function public.gl_stamp_project_milestones()     from authenticated;

-- These two are plain (non-definer) guards, but there is equally no reason for
-- them to be callable.
revoke all on function public.gl_guard_entitlement_append_only() from authenticated, public, anon;
revoke all on function public.gl_stamp_entitlement_event()       from authenticated, public, anon;

notify pgrst, 'reload schema';
