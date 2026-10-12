-- ════════════════════════════════════════════════════════════════
-- contact_submissions: strangers could send unlimited quote alerts
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK: (re-opens the hole — only if a public page must insert directly):
--   grant insert on public.contact_submissions to anon;
--   create policy "anon insert" on public.contact_submissions
--     for insert to anon with check (true);
--
-- Two INSERT policies with WITH CHECK (true) — "Anyone can submit contact
-- form" (role public) and "anon insert" (role anon) — let anyone holding the
-- publishable key write rows straight into contact_submissions. Each row
-- fires trigger_notify_new_quote, so a stranger could send Mike unlimited
-- "new quote request" Telegram + email alerts with no validation and no
-- throttle (CLAUDE.md hard rules 1 and 7). Neither policy is in any
-- migration: they were added in the dashboard (rule 2).
--
-- Nothing needs them any more: the public form calls submit_quote_request,
-- a SECURITY DEFINER function that validates, throttles and writes the row
-- itself (20261012000000_fix_public_quote_form.sql). Verified in a
-- rolled-back transaction on production: as anon, a direct insert is refused
-- (42501) and the form's dry run still returns DRY_RUN_OK. Staff policies
-- are untouched; non-staff authenticated users were already blocked by the
-- restrictive "gl tenant guard".

drop policy if exists "Anyone can submit contact form" on public.contact_submissions;
drop policy if exists "anon insert" on public.contact_submissions;
revoke insert on public.contact_submissions from anon;
