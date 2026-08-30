-- ============================================================
-- contact_submissions — raw public-site quote-form submissions
-- ============================================================
-- The marketing-site quote form (index.html submitContactForm)
-- writes the raw payload here for audit + future analytics, then
-- separately creates a `deals` row in the Prospecting stage. The
-- table was missing — every public submission was silently 404'ing
-- and only the deal-row half landed.
--
-- Public-anon insert is allowed (it's a marketing form); reads are
-- staff-only.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.contact_submissions (
  id            uuid primary key default gen_random_uuid(),
  brand_name    text,
  contact_name  text,
  email         text,
  phone         text,
  city          text,
  state         text,
  service       text,
  product_type  text,
  volume        text,
  timeline      text,
  funding_stage text,
  lead_source   text,
  message       text,
  status        text default 'new',
  created_at    timestamptz not null default now()
);

create index if not exists idx_contact_submissions_created
  on public.contact_submissions(created_at desc);
create index if not exists idx_contact_submissions_status
  on public.contact_submissions(status);

alter table public.contact_submissions enable row level security;

-- Public site can insert (anonymous quote form).
drop policy if exists "contact_submissions insert public" on public.contact_submissions;
create policy "contact_submissions insert public" on public.contact_submissions
  for insert to anon, authenticated with check (true);

-- Staff (authenticated) can read everything.
drop policy if exists "contact_submissions read authed" on public.contact_submissions;
create policy "contact_submissions read authed" on public.contact_submissions
  for select to authenticated using (true);

-- Staff can update status (e.g. mark "contacted"), no public update.
drop policy if exists "contact_submissions update authed" on public.contact_submissions;
create policy "contact_submissions update authed" on public.contact_submissions
  for update to authenticated using (true) with check (true);

-- No delete policy: contact submissions are append-only for audit.

notify pgrst, 'reload schema';
