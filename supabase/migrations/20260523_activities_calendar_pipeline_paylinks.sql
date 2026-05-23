-- ============================================================
-- activity_feed + cal_events + production_pipeline + invoices.stripe_payment_link
-- ============================================================
-- 11th, 12th, 13th, 14th, 15th of 15. Final batch of the
-- localStorage migration audit from PR #141.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── ACTIVITY FEED — human-readable team event stream ─────────
-- Different from audit_log (technical/JSON). This is the
-- emoji-prefixed "Sent invoice", "New deal", "Closed Won" feed
-- shown on the dashboard.
create table if not exists public.activity_feed (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,        -- ref / note / paid / sent / lead / pipeline ...
  icon        text,
  name        text not null,
  detail      text,
  actor_email text,
  client_id   uuid references public.clients(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_feed_created on public.activity_feed(created_at desc);

alter table public.activity_feed enable row level security;
drop policy if exists "activity_feed staff all" on public.activity_feed;
create policy "activity_feed staff all" on public.activity_feed
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── DEAL ACTIVITY — last-touched timestamp per deal name (for
--    stale-deal detection in the pipeline) ────────────────────
create table if not exists public.deal_activity (
  deal_name      text primary key,
  last_activity  timestamptz not null default now()
);

alter table public.deal_activity enable row level security;
drop policy if exists "deal_activity staff all" on public.deal_activity;
create policy "deal_activity staff all" on public.deal_activity
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── CAL_EVENTS — calendar entries (general + production) ─────
create table if not exists public.cal_events (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null default 'general',  -- general / production
  title        text not null,
  event_date   date not null,
  event_time   text,
  notes        text,
  remind       text,                              -- '0' / '15m' / '1h' / '1d' or null
  client_id    uuid references public.clients(id) on delete set null,
  format       text,
  qty          text,
  due_date     date,
  prod_status  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_cal_events_date on public.cal_events(event_date, event_type);
create index if not exists idx_cal_events_client on public.cal_events(client_id);

drop trigger if exists trg_cal_events_updated_at on public.cal_events;
create trigger trg_cal_events_updated_at before update on public.cal_events
  for each row execute function public.set_updated_at();

alter table public.cal_events enable row level security;
drop policy if exists "cal_events staff all" on public.cal_events;
create policy "cal_events staff all" on public.cal_events
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── PRODUCTION_PIPELINE — kanban deals (Scheduled → Shipped) ──
-- Distinct from public.production_runs (which is the operations
-- runs table). This is the sales-style kanban for tracking
-- production pipeline.
create table if not exists public.production_pipeline (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  company      text,
  stage        text not null default 'Scheduled' check (stage in
    ('Scheduled','In Production','Quality Check','Completed','Shipped')),
  notes        text,
  client_id    uuid references public.clients(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_production_pipeline_stage on public.production_pipeline(stage);

drop trigger if exists trg_production_pipeline_updated_at on public.production_pipeline;
create trigger trg_production_pipeline_updated_at before update on public.production_pipeline
  for each row execute function public.set_updated_at();

alter table public.production_pipeline enable row level security;
drop policy if exists "production_pipeline staff all" on public.production_pipeline;
create policy "production_pipeline staff all" on public.production_pipeline
  for all to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

-- ── INVOICE.STRIPE_PAYMENT_LINK — column on existing invoices ─
-- gl_invoice_paylinks was a {invId: url} map in localStorage.
-- Cleaner home: a column on the invoices row itself so the link
-- travels with the invoice and survives device switches.
alter table public.invoices
  add column if not exists stripe_payment_link text;

notify pgrst, 'reload schema';
