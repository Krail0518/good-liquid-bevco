-- ============================================================
-- email_log + email_schedule — staff-only RLS lockdown
-- ============================================================
-- The original 20260518_email_log_and_schedule.sql shipped these
-- two tables with `using (true) with check (true)` policies — i.e.
-- ANY authenticated session could read/write every row.
--
-- Both tables hold sensitive cross-customer content:
--   email_log     — every outbound email body, recipient, status,
--                   open/click telemetry, Mailgun message-id
--   email_schedule — pending sends queued for later delivery
--
-- Portal customers are `authenticated` too. Under the old policy a
-- compromised (or curious) customer browser could:
--   • read every email sent to every other client
--   • cancel pending follow-ups for other clients
--   • DELETE rows to destroy the audit trail
--   • INSERT fake rows to forge a send history
--
-- This migration replaces the wide-open policies with staff-only
-- read/write. Edge Functions that need to touch these tables (the
-- mailgun-webhook function ingesting open/click events, the
-- email-scheduler cron job) use the service-role key and bypass
-- RLS anyway, so no Edge Function flow is affected.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── email_log ────────────────────────────────────────────────
drop policy if exists "email_log authed" on public.email_log;

drop policy if exists "email_log staff select" on public.email_log;
create policy "email_log staff select" on public.email_log
  for select to authenticated
  using (public.is_staff_user());

drop policy if exists "email_log staff insert" on public.email_log;
create policy "email_log staff insert" on public.email_log
  for insert to authenticated
  with check (public.is_staff_user());

drop policy if exists "email_log staff update" on public.email_log;
create policy "email_log staff update" on public.email_log
  for update to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists "email_log staff delete" on public.email_log;
create policy "email_log staff delete" on public.email_log
  for delete to authenticated
  using (public.is_staff_user());

-- ── email_schedule ───────────────────────────────────────────
drop policy if exists "email_schedule authed" on public.email_schedule;

drop policy if exists "email_schedule staff select" on public.email_schedule;
create policy "email_schedule staff select" on public.email_schedule
  for select to authenticated
  using (public.is_staff_user());

drop policy if exists "email_schedule staff insert" on public.email_schedule;
create policy "email_schedule staff insert" on public.email_schedule
  for insert to authenticated
  with check (public.is_staff_user());

drop policy if exists "email_schedule staff update" on public.email_schedule;
create policy "email_schedule staff update" on public.email_schedule
  for update to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists "email_schedule staff delete" on public.email_schedule;
create policy "email_schedule staff delete" on public.email_schedule
  for delete to authenticated
  using (public.is_staff_user());

notify pgrst, 'reload schema';
