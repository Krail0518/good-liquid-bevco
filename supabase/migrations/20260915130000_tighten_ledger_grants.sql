-- ════════════════════════════════════════════════════════════════
-- Make the table grants say what the comments already claimed
-- ════════════════════════════════════════════════════════════════
-- Three tables shipped this week describe themselves as append-only or
-- read-only "in the grant as well as the trigger":
--
--   artwork_reviews             (20260915000000)
--   project_entitlement_events  (20260914090100)
--   formula_document_downloads  (20260915120000)
--
-- Each did `revoke all ... from anon, public` and then granted back only what
-- it wanted. That is not sufficient on Supabase, for exactly the reason
-- 20260914090500 exists for functions: the project's DEFAULT PRIVILEGES grant
-- the full set to `authenticated` separately, and revoking public and anon
-- never touches it. So `authenticated` has held INSERT/UPDATE/DELETE at the
-- table level the whole time.
--
-- Nothing was exposed. RLS refused every one of those writes — no permissive
-- policy admits a customer, the restrictive guard requires is_gl_staff(), and
-- the append-only triggers raise 42501 regardless of who is asking. Verified
-- by probing as a real portal customer before writing this.
--
-- The defect is that a comment claimed a second layer that was not there. The
-- next person to read "append-only in the grant as well as the trigger" would
-- have believed it, and a guard nobody checks is how a layer quietly becomes
-- the only layer. Either the grant matches the sentence or the sentence goes;
-- this makes the grant match.
--
-- ROLLBACK:
--   grant insert, update, delete on public.formula_document_downloads to authenticated;
--   grant update, delete on public.artwork_reviews to authenticated;
--   grant update, delete on public.project_entitlement_events to authenticated;
--   Reverting restores table privileges that RLS and the triggers refuse anyway;
--   nothing starts working that does not work today.

set search_path = public, extensions;

-- Only the service role writes the access log, from inside portal-formula-doc.
revoke insert, update, delete on public.formula_document_downloads from authenticated;

-- Append-only ledgers: a row is recorded once and never edited or removed.
revoke update, delete on public.artwork_reviews from authenticated;
revoke update, delete on public.project_entitlement_events from authenticated;

notify pgrst, 'reload schema';
