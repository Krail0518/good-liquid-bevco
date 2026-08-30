-- ============================================================
-- Security hardening — 2026-05-25
-- Fixes found in full-site security audit:
--
-- 1. contact_submissions: SELECT + UPDATE were open to ALL
--    authenticated users (including portal customers). A portal
--    customer using DevTools could read every marketing inquiry
--    (competitor intel, prospect names, phone numbers).
--    Fixed: scope SELECT to staff, UPDATE to staff + super.
--
-- 2. app_settings: new table for org-wide configuration that
--    was previously stored in per-device localStorage:
--      - SMS notification toggles & phone numbers
--      - CCP (Critical Control Point) limit overrides
--      - Compliance task visibility overrides
--      - Dropbox Sign template mappings
--      - Service package pricing
--    All sensitive to inconsistency across staff browsers.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── 1. contact_submissions: tighten SELECT and UPDATE ──────
drop policy if exists "contact_submissions read authed"  on public.contact_submissions;
drop policy if exists "contact_submissions update authed" on public.contact_submissions;

-- Staff-only select (portal customers cannot read prospect inquiries)
create policy "contact_submissions staff select" on public.contact_submissions
  for select to authenticated
  using (public.is_staff_user());

-- Staff insert/update; super-only delete (already from rls_authed_all era)
create policy "contact_submissions staff update" on public.contact_submissions
  for update to authenticated
  using  (public.is_staff_user())
  with check (public.is_staff_user());

-- Anon insert policy (marketing form from public site) — keep as-is
-- (it was created in 20260524_contact_submissions_table.sql and is correct)

-- ── 2. app_settings — org-wide config table ──────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Enable RLS
alter table public.app_settings enable row level security;

-- Any staff member can read settings (needed to enforce CCP limits, etc.)
drop policy if exists "app_settings staff read" on public.app_settings;
create policy "app_settings staff read" on public.app_settings
  for select to authenticated
  using (public.is_staff_user());

-- Only admins can write settings (super-only for destructive ops, admin for normal)
drop policy if exists "app_settings admin write" on public.app_settings;
create policy "app_settings admin write" on public.app_settings
  for all to authenticated
  using  (public.is_staff_user() and exists(
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin','super')
          ))
  with check (public.is_staff_user() and exists(
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin','super')
          ));

-- Auto-update timestamp
create or replace function public.app_settings_updated_at()
returns trigger language plpgsql security definer as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;$$;

drop trigger if exists trg_app_settings_ts on public.app_settings;
create trigger trg_app_settings_ts
  before update on public.app_settings
  for each row execute function public.app_settings_updated_at();

-- ── Seed default settings ──────────────────────────────────
-- SMS notifications (previously in localStorage per device)
insert into public.app_settings (key, value) values
  ('sms_notifications', '{"paid":true,"won":true,"quote":true,"tour":true,"overdue":true,"phone":""}'::jsonb),
  ('sms_fn_url',        'null'::jsonb),
  -- CCP limits (FDA Critical Control Point thresholds)
  ('ccp_limits',        '{}'::jsonb),
  -- Compliance task type visibility
  ('compliance_hidden_task_types', '[]'::jsonb),
  -- Dropbox Sign template mappings: { "Template Name": "template_id" }
  ('sign_templates',    '{}'::jsonb),
  -- Service packages pricing
  ('service_packages',  '[]'::jsonb),
  -- Stripe publishable key (stored here so all browsers stay in sync)
  ('stripe_pub_key',    'null'::jsonb),
  -- Sentry DSN
  ('sentry_dsn',        'null'::jsonb),
  -- QBO connection flag
  ('qbo_connected',     'false'::jsonb),
  -- AI model key placeholder (actual key stays in edge function secrets)
  ('ai_settings',       '{"model":"claude-opus-4-5","context_window":4096}'::jsonb)
on conflict (key) do nothing;

-- Realtime broadcast so all open browser tabs pick up setting changes
alter publication supabase_realtime add table public.app_settings;

notify pgrst, 'reload schema';
