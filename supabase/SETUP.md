# Supabase setup — Good Liquid CRM

This folder holds everything you need to take the CRM from "works on
one device via localStorage" to **fully synced across devices** with
real edge-function integrations.

Two pieces:

1. **`migrations/`** — SQL files that create the 14 new tables (CIP logs,
   defects, formulas, production runs, etc.) plus `qbo_tokens` for QuickBooks.
2. **`functions/`** — Deno-based serverless functions for Stripe, Twilio,
   Dropbox Sign, and QuickBooks. Deployed via `deploy-functions.sh`.

---

## Prerequisites (~5 minutes, one-time)

```bash
# 1. Install the Supabase CLI
brew install supabase/tap/supabase                      # macOS
# OR
winget install Supabase.CLI                             # Windows
# OR see https://supabase.com/docs/guides/cli/getting-started

# 2. Log in (opens browser)
supabase login

# 3. Link this repo to your Supabase project
cd /path/to/good-liquid-bevco/goodliquid
supabase link --project-ref <your-project-ref>
# (find <your-project-ref> in Supabase dashboard → Settings → General → Reference ID)
```

---

## Part 1 — Apply the database migrations

Two migration files create the 14 new feature tables + `qbo_tokens`.
Both are **idempotent** (safe to re-run).

```bash
# Push all migrations to your project
supabase db push
```

That runs both:
- `migrations/20260516_new_feature_tables.sql` (14 tables + indexes + RLS)
- `migrations/20260516_qbo_tokens.sql` (single-row OAuth token store)

### Verify it worked

In the Supabase SQL editor:

```sql
select tablename from pg_tables
where schemaname = 'public'
  and tablename = any (array[
    'audit_log','capacity','case_studies','cip_logs','content_calendar',
    'defects','formulas','nps_responses','production_runs','qbo_tokens',
    'resources','sample_shipments','trade_shows','vendors','yield_logs'
  ])
order by tablename;
```

Should return **15 rows**. If any are missing, the migration failed —
check the Supabase logs for errors.

### What changes after migrating

Features that previously fell back to localStorage now write to the
database, which means:
- **Cross-device sync** — log a defect on your laptop, see it on your phone.
- **Real audit trail** — every mutation lands in `audit_log` and is
  visible to every user.
- **Multi-user safety** — two admins editing the same client formula no
  longer overwrite each other.

Existing localStorage data is **not** migrated automatically. If you
have important local data, export it from the CRM (Reports →
"Download all data") before switching.

---

## Part 2 — Deploy the edge functions

The CRM ships 7 edge functions for integrations that can't safely run
client-side (they hold API secrets):

| Function | Purpose |
|---|---|
| `stripe-checkout-session` | Generate Stripe Checkout URL for an invoice |
| `send-sms` | Send a single SMS via Twilio |
| `dropbox-sign` | Send a signature request via Dropbox Sign |
| `qbo-connect` | Returns Intuit OAuth URL (kicks off QuickBooks connect) |
| `qbo-callback` | OAuth redirect target — stores tokens |
| `qbo-disconnect` | Revoke Intuit token + clear local row |
| `qbo-push-invoice` | Push an invoice to QuickBooks Online |

### 2a. Set up your secrets

```bash
cp supabase/secrets.example.env supabase/secrets.env
# Open supabase/secrets.env in any editor and fill in the keys
# you actually have. Leave the rest blank — they'll be skipped.
```

The `secrets.env` file is **gitignored** so you won't accidentally
commit it. Keep your only copy somewhere safe (1Password etc.).

You don't have to set every key on first deploy. Empty values are
skipped. You can re-run the script later to add more.

### 2b. Run the deploy script

```bash
bash supabase/deploy-functions.sh
```

You'll see something like:

```
🔧 Good Liquid CRM — Edge function deploy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ supabase CLI:   1.187.0
✓ Logged in
✓ Project linked
✓ Secrets file:   /repo/supabase/secrets.env

📦 Setting secrets...
  ✓ stage STRIPE_SECRET_KEY
  ✓ stage TWILIO_ACCOUNT_SID
  ✓ stage TWILIO_AUTH_TOKEN
  ⊘ skip HELLOSIGN_API_KEY (placeholder or empty)
  ...
  → 7 secret(s) set

🚀 Deploying functions...
  ─── stripe-checkout-session ───
  Deployed Function stripe-checkout-session on project xyz
  ...

✅ Deploy complete
Deployed (7):
  ✓ stripe-checkout-session → https://xyz.supabase.co/functions/v1/stripe-checkout-session
  ...
```

### 2c. Configure Intuit's OAuth redirect (QuickBooks only)

After deploy, set the OAuth redirect URI in your Intuit developer app to:

```
https://<your-project-ref>.supabase.co/functions/v1/qbo-callback
```

Then in the CRM:
**🤖 toolbar → ⚙ Settings → 💼 QuickBooks → Connect**

A popup walks you through the Intuit consent flow. After you grant
access, the popup closes and the CRM shows "Connected".

---

## Adding API keys in the CRM

Some features need API keys saved **in the CRM** (not as edge function
secrets) because the AI calls run client-side:

| Setting | Where to add it | Why |
|---|---|---|
| Anthropic API key | 🤖 toolbar → ⚙ Settings → 🤖 AI Settings | Powers every AI tool (Social Drafter, Auto Case Study, etc.) |
| Mailgun API key | 🤖 toolbar → ⚙ Settings → 📧 Mailgun | Outgoing email (invoices, customer portal invites, follow-ups) |
| Google Analytics ID | 🤖 toolbar → ⚙ Settings → 📈 Google Analytics | Tracks public-site visitors |
| Sentry DSN | 🤖 toolbar → ⚙ Settings → 🛡️ Sentry | Front-end error reporting |

These get stored per-device in `localStorage` (and synced to a
`profiles.config` JSON column if you've set that up server-side).

---

## Troubleshooting

**"Supabase CLI not found"**
The CLI installed but isn't on PATH. Restart your shell, or run
the full binary path: `~/.brew/bin/supabase` (macOS) /
`%LOCALAPPDATA%\Microsoft\WinGet\Links\supabase.exe` (Windows).

**"Project not linked"**
Run `supabase link --project-ref <ref>` from the repo root.
Find `<ref>` in Supabase dashboard → Settings → General.

**Migration succeeds but tables don't appear**
Refresh the Supabase dashboard. The table editor caches schema.

**Edge function deploy hangs**
Run `supabase functions deploy <one-name> --debug` to see what's stuck.
Usually a slow npm/Deno cache fetch on first run.

**Customer Portal Pay Now does nothing**
The `stripe-checkout-session` function needs `STRIPE_SECRET_KEY` set
AND the invoice needs a `stripe_payment_link` column populated. Re-run
the deploy after adding the key.

**NPS public link returns 401**
The public NPS form writes via the anon role. The migration includes
the right RLS policy, but if you previously created `nps_responses`
manually without that policy, re-run the migration — it's idempotent
and will reset the policy correctly.

---

## What's NOT in here

- **Schema for the existing tables** (`clients`, `invoices`, `deals`,
  `profiles`, `customer_logins`, `referrers`, …). Those were created
  earlier and are managed in your Supabase dashboard. If you ever need
  to recreate them from scratch, dump the schema from production:
  ```bash
  supabase db dump --schema public > supabase/migrations/00000_baseline.sql
  ```

- **Real production data**. None of this touches your live data.
  Migrations only create empty tables.

- **Cron jobs.** A few features (anniversary tracker, churn detector)
  run client-side on each dashboard render — no server-side cron needed.
