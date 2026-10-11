-- ════════════════════════════════════════════════════════════════
-- Remove e-signature links from stored email text
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK: none — the links are removed on purpose and cannot be restored.
--   Nothing depends on them: each signer still has their link in their own
--   inbox, and staff can resend a fresh one from the CRM.
--
-- A signing link (sign.html#t=<token>) lets whoever holds it sign as that
-- customer. agreement-sign keeps it out of every server log, but gmail-sync
-- copied sent signing emails, link included, into email_log, which every
-- staff member can read. From this change on, both agreement-sign (which
-- now logs its own emails) and gmail-sync store the text with the link
-- replaced; this clears the rows already there. No permission changes.

update public.email_log
   set body_preview = regexp_replace(
         body_preview,
         'https?://[^\s"''<>()]*sign\.html#t=[^\s"''<>()]+',
         '[personal signing link]',
         'gi')
 where body_preview ~* 'sign\.html#t=';
