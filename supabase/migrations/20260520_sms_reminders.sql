-- ============================================================
-- SMS overdue reminders — schema additions
-- ============================================================
-- 1) followup_log.channel — flag a follow-up row as 'email' or 'sms'.
--    Existing rows backfill to 'email' (current behavior).
--
-- 2) clients.notify_overdue_sms — per-client opt-in for receiving
--    SMS reminders on past-due invoices. Default false so we do NOT
--    spam customers without their consent. Staff flips this on the
--    Edit Client modal once the customer has explicitly opted in
--    (PCI/CAN-SPAM-equivalent stance: SMS opt-in must be explicit).
--
-- The SMS send itself happens client-side via the existing send-sms
-- Edge Function (Twilio). No server-side trigger.
--
-- Idempotent. Safe to re-run.
-- ============================================================

alter table public.followup_log
  add column if not exists channel text not null default 'email';
alter table public.followup_log
  drop constraint if exists followup_log_channel_check;
alter table public.followup_log
  add constraint followup_log_channel_check check (channel in ('email','sms'));

alter table public.clients
  add column if not exists notify_overdue_sms boolean not null default false;

comment on column public.followup_log.channel is
  'Delivery channel for the follow-up: "email" (default) or "sms".';
comment on column public.clients.notify_overdue_sms is
  'When true, the customer has opted in to receive SMS reminders for past-due invoices. Default false — opt-in only.';

notify pgrst, 'reload schema';
