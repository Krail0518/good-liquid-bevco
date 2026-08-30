-- ============================================================
-- Email log + scheduled follow-ups
-- ============================================================
-- Two related tables for outbound email tracking and scheduling:
--
-- email_log: every email sent through the app, with the Mailgun
-- message-id so we can correlate webhook events (opens / clicks /
-- bounces) back to a sent message. Status is updated when Mailgun
-- webhooks fire (see supabase/functions/mailgun-webhook/).
--
-- email_schedule: pending follow-ups queued for later send. A
-- Supabase Edge Function + pg_cron job picks up due rows every
-- 15 min and sends them via Mailgun.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- email_log
create table if not exists public.email_log (
  id              uuid primary key default gen_random_uuid(),
  mailgun_id      text,
  to_email        text not null,
  cc_emails       text[],
  bcc_emails      text[],
  subject         text not null,
  body_preview    text,
  invoice_id      uuid references public.invoices(id) on delete set null,
  invoice_number  text,
  template_name   text,
  status          text not null default 'queued' check (status in ('queued','sent','delivered','opened','clicked','bounced','failed')),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  first_opened_at timestamptz,
  open_count      integer not null default 0,
  click_count     integer not null default 0,
  bounce_reason   text,
  sent_by         uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_email_log_invoice on public.email_log(invoice_id);
create index if not exists idx_email_log_status on public.email_log(status);
create index if not exists idx_email_log_mailgun on public.email_log(mailgun_id);
create index if not exists idx_email_log_sent on public.email_log(sent_at desc);

alter table public.email_log enable row level security;
drop policy if exists "email_log authed" on public.email_log;
create policy "email_log authed" on public.email_log
  for all to authenticated using (true) with check (true);

-- email_schedule (deferred sends)
create table if not exists public.email_schedule (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid references public.invoices(id) on delete cascade,
  to_email       text not null,
  cc_emails      text[],
  subject        text not null,
  body           text not null,
  send_at        timestamptz not null,
  status         text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts       integer not null default 0,
  last_error     text,
  sent_at        timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_email_schedule_due on public.email_schedule(send_at) where status = 'pending';
create index if not exists idx_email_schedule_status on public.email_schedule(status);

alter table public.email_schedule enable row level security;
drop policy if exists "email_schedule authed" on public.email_schedule;
create policy "email_schedule authed" on public.email_schedule
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
