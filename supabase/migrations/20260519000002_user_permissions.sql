-- ============================================================
-- Per-user, per-component permissions system
-- ============================================================
-- Lets the admin turn individual CRM features (pages today, can
-- extend to actions tomorrow) on/off per staff user. A global
-- default_on flag controls what a NEW user sees by default; the
-- user_permissions table holds explicit overrides per (user_id,
-- component_id).
--
-- The helper user_has_permission(component_id) is what the JS
-- (and any future RLS policies) call to test access. Admins
-- (`profiles.role = 'admin'`) bypass all checks.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.permission_components (
  id           text primary key,
  label        text not null,
  category     text not null default 'page' check (category in ('page','action','data')),
  description  text,
  default_on   boolean not null default true,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now()
);
create index if not exists idx_perm_components_sort on public.permission_components(sort_order, label);

create table if not exists public.user_permissions (
  user_id      uuid not null references auth.users(id) on delete cascade,
  component_id text not null references public.permission_components(id) on delete cascade,
  granted      boolean not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (user_id, component_id)
);
create index if not exists idx_user_perms_user on public.user_permissions(user_id);

alter table public.permission_components enable row level security;
alter table public.user_permissions enable row level security;

-- Read access: every authenticated user can read the component catalog
-- (the JS uses it to render available toggles) and their OWN permission rows.
drop policy if exists "perm_components read" on public.permission_components;
create policy "perm_components read" on public.permission_components
  for select to authenticated using (true);

drop policy if exists "user_perms read self" on public.user_permissions;
create policy "user_perms read self" on public.user_permissions
  for select to authenticated using (user_id = auth.uid());

-- Admin write: only profiles.role='admin' staff can mutate either table.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_admin_user() to authenticated;

drop policy if exists "perm_components admin write" on public.permission_components;
create policy "perm_components admin write" on public.permission_components
  for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "user_perms admin all" on public.user_permissions;
create policy "user_perms admin all" on public.user_permissions
  for all to authenticated
  using (public.is_admin_user() or user_id = auth.uid())
  with check (public.is_admin_user());

-- ── Helper: does the calling user have permission for this component? ────
-- Admins always return true. Otherwise: explicit row wins; else default_on.
create or replace function public.user_has_permission(p_component_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin_user() then true
    else coalesce(
      (select granted from public.user_permissions
        where user_id = auth.uid() and component_id = p_component_id),
      (select default_on from public.permission_components where id = p_component_id),
      false
    )
  end;
$$;
grant execute on function public.user_has_permission(text) to authenticated;

-- ── Seed: every sidebar page in the CRM ──────────────────────────────────
insert into public.permission_components (id, label, category, description, default_on, sort_order) values
  ('page.dashboard',       'Dashboard',           'page', 'Top-level KPI dashboard',                 true,  10),
  ('page.clients',         'Clients',             'page', 'Client list + detail',                    true,  20),
  ('page.pipeline',        'Pipeline',            'page', 'Sales/production kanban',                 true,  30),
  ('page.invoices',        'Invoices',            'page', 'Invoice list + details',                  true,  40),
  ('page.newinv',          'New Invoice',         'page', 'Create a new invoice',                    true,  41),
  ('page.referrals',       'Referrals',           'page', 'Referral pipeline + commissions',         true,  50),
  ('page.referrers',       'Referrers',           'page', 'People who refer clients',                true,  51),
  ('page.activity',        'Activity',            'page', 'Team activity log',                       true,  60),
  ('page.production-runs', 'Production Runs',     'page', 'Production batch board',                  true,  70),
  ('page.samples',         'Sample Shipments',    'page', 'Sample tracking + follow-ups',            true,  71),
  ('page.calendar',        'General Calendar',    'page', 'Meetings, tours, etc.',                   true,  80),
  ('page.production-cal',  'Production Schedule', 'page', 'Production calendar',                     true,  81),
  ('page.formulas',        'Formula Vault',       'page', 'Recipes + version history',               true,  90),
  ('page.yield',           'Yield Tracker',       'page', 'Run yield analysis',                      true,  91),
  ('page.content',         'Content Calendar',    'page', 'Social media planning',                   true, 100),
  ('page.compliance',      'Compliance Tasks',    'page', 'GMP / FDA checklist',                     true, 110),
  ('page.cip',             'CIP / Sanitation',    'page', 'Cleaning cycles + chemicals',             true, 111),
  ('page.holds',           'Hold Tags',           'page', 'QC holds + dispositions',                 true, 112),
  ('page.audit',           'Audit Log',           'page', 'All admin actions',                       false, 113),
  ('page.defects',         'Defects / NCRs',      'page', 'Non-conformance reports',                 true, 120),
  ('page.vendors',         'Vendors',             'page', 'Supplier directory + COI',                true, 121),
  ('page.tasks',           'Tasks',               'page', 'Personal + team to-do list',              true, 130),
  ('page.documents',       'Documents',           'page', 'File storage + downloads',                true, 131),
  ('page.inventory',       'Inventory',           'page', 'Stock + reorder thresholds',              true, 132),
  ('page.announcements',   'Announcements',       'page', 'Internal broadcasts',                     true, 133),
  ('page.time-tracker',    'Time Tracker',        'page', 'Clock in/out + timesheets',               true, 134),
  ('page.users',           'Users & Permissions', 'page', 'Manage staff + component permissions',    false, 200),
  ('page.customers',       'Customer Logins',     'page', 'Manage customer portal accounts',         false, 201),
  ('page.reports',         'Reports',             'page', 'Export / reporting',                      true, 210),
  ('page.ai-settings',     'AI Settings',         'page', 'AI assistance toggles',                   false, 220)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
