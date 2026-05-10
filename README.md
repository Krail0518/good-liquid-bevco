# Good Liquid Bev Co — Web App

Full-stack Next.js + Supabase application for goodliquidbevco.com

## Stack
- **Framework:** Next.js 14 (App Router)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **Hosting:** Vercel
- **Email:** Resend
- **Styling:** Tailwind CSS

---

## Setup Instructions

### Step 1 — Supabase Database

1. Go to your Supabase project: https://supabase.com/dashboard/project/ufjkeqmxwuyhbqyugcgg
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Copy the entire contents of `supabase-schema.sql`
5. Paste it in and click **Run**
6. You should see "Success" — all tables are now created

### Step 2 — Create user accounts in Supabase

1. In Supabase → **Authentication** → **Users** → **Add user**
2. Add Mike:
   - Email: `mike@goodliquid.com`
   - Password: choose a strong password
   - Click Create
3. Add Sandra:
   - Email: `sandra@goodliquid.com`
   - Password: choose a strong password
4. Copy both user UUIDs (shown in the users table)
5. Go back to SQL Editor and run:

```sql
INSERT INTO public.profiles (id, name, email, role, initials, color, tc)
VALUES
  ('PASTE_MIKES_UUID_HERE', 'Mike Krail', 'mike@goodliquid.com', 'admin', 'MK', '#0F6E56', '#E1F5EE'),
  ('PASTE_SANDRAS_UUID_HERE', 'Sandra Krail', 'sandra@goodliquid.com', 'sales', 'SK', '#1a3a6e', '#9FE1CB');
```

### Step 3 — Set up Resend (email sending)

1. Go to **resend.com** and create a free account
2. Click **API Keys** → Create API key
3. Copy the key (starts with `re_`)
4. Add your domain in Resend → Domains → Add domain → `goodliquidbevco.com`
5. Follow their DNS instructions (add 3 DNS records in Namecheap)

### Step 4 — Local development

```bash
# Clone the repo
git clone https://github.com/Krail0518/good-liquid-bevco.git
cd good-liquid-bevco

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and fill in your Resend API key

# Run development server
npm run dev

# Open http://localhost:3000
```

### Step 5 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial Good Liquid Bev Co app"
git remote add origin https://github.com/Krail0518/good-liquid-bevco.git
git push -u origin main
```

### Step 6 — Deploy to Vercel

1. Go to **vercel.com** → New Project
2. Import from GitHub → select `good-liquid-bevco`
3. Add environment variables (same as your .env.local):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `RESEND_API_KEY`
   - `NEXT_PUBLIC_SITE_URL` = `https://www.goodliquidbevco.com`
4. Click Deploy
5. Add your custom domain: goodliquidbevco.com

---

## CRM Access

- URL: `https://www.goodliquidbevco.com/admin`
- Mike: `mike@goodliquid.com` / [password you set in Supabase]
- Sandra: `sandra@goodliquid.com` / [password you set in Supabase]

## Roles
- **Admin** (Mike) — full access including user management
- **Sales** (Sandra) — clients, pipeline, invoices, referrals
- **Viewer** — dashboard and clients only

---

## Adding new users

1. In Supabase → Authentication → Users → Add user
2. Set their email and a temp password
3. Run SQL to add their profile with role
4. Share credentials with them

## Monthly costs
- Vercel: Free
- Supabase: Free (up to 500MB, 50k users)
- Resend: Free (3,000 emails/mo)
- Domain: ~$1.25/mo
- **Total: ~$1.25/mo**
