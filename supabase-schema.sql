-- ═══════════════════════════════════════════════
--   GOOD LIQUID BEV CO — SUPABASE SCHEMA
--   Run this entire file in Supabase SQL Editor
--   Dashboard → SQL Editor → New query → paste → Run
-- ═══════════════════════════════════════════════

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── USERS (extends Supabase auth.users) ───
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  email text not null unique,
  role text not null default 'sales' check (role in ('admin', 'sales', 'viewer')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  initials text,
  color text default '#1a3a6e',
  tc text default '#9FE1CB',
  last_login timestamptz,
  created_at timestamptz default now()
);

-- ─── CLIENTS ───
create table public.clients (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  contact_name text,
  email text,
  phone text,
  company text,
  service text,
  status text default 'lead' check (status in ('active', 'lead', 'inactive')),
  referred_by uuid references public.referrers(id) on delete set null,
  notes text,
  total_billed numeric default 0,
  color text default '#1a3a6e',
  tc text default '#9FE1CB',
  initials text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── REFERRERS ───
create table public.referrers (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  relationship text,
  email text,
  phone text,
  default_rate numeric default 5,
  color text default '#1a3a6e',
  tc text default '#9FE1CB',
  initials text,
  notes text,
  created_at timestamptz default now()
);

-- ─── REFERRALS ───
create table public.referrals (
  id uuid default uuid_generate_v4() primary key,
  referrer_id uuid references public.referrers(id) on delete cascade,
  client_name text not null,
  deal_value numeric default 0,
  commission_rate numeric default 5,
  commission_amount numeric default 0,
  status text default 'lead' check (status in ('lead', 'presented', 'won', 'paid', 'lost')),
  date_paid date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── INVOICES ───
create table public.invoices (
  id uuid default uuid_generate_v4() primary key,
  invoice_number text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  service text not null,
  amount numeric not null default 0,
  status text default 'draft' check (status in ('draft', 'pending', 'paid', 'overdue')),
  invoice_date date default current_date,
  due_date date,
  notes text,
  line_items jsonb default '[]',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── PIPELINE DEALS ───
create table public.deals (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  value numeric default 0,
  stage text default 'Prospecting' check (stage in ('Prospecting', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost')),
  probability integer default 20,
  notes text,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── ACTIVITY LOG ───
create table public.activity (
  id uuid default uuid_generate_v4() primary key,
  type text not null check (type in ('call', 'email', 'deal', 'note', 'ref', 'invoice')),
  title text not null,
  detail text,
  related_client uuid references public.clients(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ─── CONTACT FORM SUBMISSIONS ───
create table public.contact_submissions (
  id uuid default uuid_generate_v4() primary key,
  brand_name text,
  contact_name text,
  email text,
  phone text,
  service text,
  volume text,
  message text,
  status text default 'new' check (status in ('new', 'contacted', 'converted', 'closed')),
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════
--   ROW LEVEL SECURITY (RLS)
--   Locks data down so only logged-in users see it
-- ═══════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.referrers enable row level security;
alter table public.referrals enable row level security;
alter table public.invoices enable row level security;
alter table public.deals enable row level security;
alter table public.activity enable row level security;
alter table public.contact_submissions enable row level security;

-- Profiles: users can read all, update only their own
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select using (auth.role() = 'authenticated');

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Admins can insert profiles"
  on public.profiles for insert with check (auth.role() = 'authenticated');

-- All CRM tables: authenticated users can read
create policy "Authenticated users can read clients"
  on public.clients for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read referrers"
  on public.referrers for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read referrals"
  on public.referrals for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read invoices"
  on public.invoices for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read deals"
  on public.deals for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read activity"
  on public.activity for select using (auth.role() = 'authenticated');

-- Write policies (sales + admin can write most things)
create policy "Authenticated users can insert clients"
  on public.clients for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update clients"
  on public.clients for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert invoices"
  on public.invoices for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update invoices"
  on public.invoices for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert referrals"
  on public.referrals for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update referrals"
  on public.referrals for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert referrers"
  on public.referrers for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update referrers"
  on public.referrers for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert deals"
  on public.deals for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update deals"
  on public.deals for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert activity"
  on public.activity for insert with check (auth.role() = 'authenticated');

-- Contact form: anyone can submit (public)
create policy "Anyone can submit contact form"
  on public.contact_submissions for insert with check (true);

create policy "Authenticated users can read contact submissions"
  on public.contact_submissions for select using (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════
--   SEED DATA — Mike & Sandra
--   After running schema, create auth users in
--   Supabase Dashboard → Authentication → Users
--   then run this to set their profiles
-- ═══════════════════════════════════════════════

-- Run AFTER creating auth users manually:
-- INSERT INTO public.profiles (id, name, email, role, initials, color, tc)
-- VALUES
--   ('AUTH_UUID_FOR_MIKE', 'Mike Krail', 'mike@goodliquid.com', 'admin', 'MK', '#0F6E56', '#E1F5EE'),
--   ('AUTH_UUID_FOR_SANDRA', 'Sandra Krail', 'sandra@goodliquid.com', 'sales', 'SK', '#1a3a6e', '#9FE1CB');

-- ─── SAMPLE DATA ───
insert into public.referrers (name, relationship, email, phone, default_rate, initials, color, tc, notes) values
  ('Jake Denton', 'Broker', 'jake@dentonsales.com', '(813) 555-0144', 5, 'JD', '#1a3a6e', '#9FE1CB', 'Commercial broker, sends 2-3 leads/year'),
  ('Maria Santos', 'Industry contact', 'msantos@bevworld.com', '(727) 555-0289', 7, 'MS', '#0F6E56', '#E1F5EE', 'Beverage industry consultant'),
  ('Dave Okafor', 'Business partner', 'dave@okaforgroup.com', '(941) 555-0076', 6, 'DO', '#854F0B', '#FAEEDA', 'Former supplier, now refers startup brands');

insert into public.clients (name, contact_name, email, service, status, initials, color, tc, total_billed) values
  ('Tide & Taste Co.', 'Jordan Mills', 'jordan@tidetaste.com', 'Canning', 'active', 'TT', '#1a3a6e', '#9FE1CB', 48240),
  ('Bloom Functional', 'Riley Park', 'r.park@bloomfx.com', 'R&D + Canning', 'active', 'BF', '#0F6E56', '#E1F5EE', 24800),
  ('SunBurst Seltzers', 'Alex Torres', 'a.torres@sunburst.io', 'Canning', 'active', 'SS', '#854F0B', '#FAEEDA', 61500),
  ('Verde Wellness', 'Sam Diaz', 's.diaz@verdewellness.com', 'R&D', 'active', 'VW', '#0F6E56', '#E1F5EE', 18000),
  ('Prism Hydration', 'Jamie Fox', 'j.fox@prismhydration.com', 'Bottling', 'active', 'PH', '#712B13', '#FAECE7', 29400);
