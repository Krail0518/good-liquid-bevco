-- ============================================================
-- Production-run stage-change notification preferences
-- ============================================================
-- When a staff user advances a production run between kanban stages
-- (Discovery → Formulation → Sample → COA → Production → Ship), the
-- portal customer for that client gets a heads-up email. This migration
-- adds the opt-in column on customer_users so customers can later
-- toggle it from portal account settings.
--
-- Default is true: existing portal users opt-in automatically so the
-- feature works for everyone on day one. The email send itself happens
-- client-side from the CRM (calls the existing mailgun-send Edge
-- Function) — no server-side trigger needed.
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.customer_users
  add column if not exists notify_run_stage_changes boolean not null default true;

comment on column public.customer_users.notify_run_stage_changes is
  'When true, this portal customer receives an email when their production run advances a stage. Default true — customer can opt out from portal account settings.';

notify pgrst, 'reload schema';
