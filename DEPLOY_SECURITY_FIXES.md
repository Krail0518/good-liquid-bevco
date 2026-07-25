# Deploying the security-audit fixes

The frontend fixes deploy automatically when the pull request is merged (Vercel).
The **database** and **edge-function** fixes must be applied to Supabase by hand.
The share-link code was made backward-compatible, so **order does not matter and
there is no downtime** — do the steps whenever is convenient.

Your Supabase project: `ufjkeqmxwuyhbqyugcgg`

---

## Step 1 — Merge the pull request (frontend fixes go live)

Click: **https://github.com/Krail0518/good-liquid-bevco/pull/166**

Press the green **Merge pull request** button, then **Confirm merge**.
Vercel redeploys the site automatically (~1–2 min). This ships the XSS fixes,
the persistence fixes, and the backward-compatible share-link code.

---

## Step 2 — Apply the database migration (can be done on a phone)

This is the most important step — it closes the customer-data holes.

1. Open the SQL editor:
   **https://supabase.com/dashboard/project/ufjkeqmxwuyhbqyugcgg/sql/new**
   (log in if prompted)
2. Open the migration file and copy **all** of its text:
   **https://raw.githubusercontent.com/Krail0518/good-liquid-bevco/main/supabase/migrations/20260725_security_audit_hardening.sql**
   (if that shows "404", the PR isn't merged yet — use this branch link instead:
   https://raw.githubusercontent.com/Krail0518/good-liquid-bevco/claude/crm-page-loading-issue-y9leun/supabase/migrations/20260725_security_audit_hardening.sql )
3. Paste it into the SQL editor and press **Run** (bottom-right).
4. You should see **"Success. No rows returned."** That's it — the RLS holes are closed.

It is safe to run more than once (every statement is `drop … if exists` / `create or replace`).

---

## Step 3 — Redeploy the edge functions (needs a computer)

The 13 changed functions can't be deployed from a phone — they need the Supabase
CLI on a computer (yours or a developer's). It's two commands:

1. Install the CLI (one time): **https://supabase.com/docs/guides/cli/getting-started**
2. From the project folder:
   ```bash
   supabase login
   supabase link --project-ref ufjkeqmxwuyhbqyugcgg
   supabase functions deploy
   ```
   (or run the bundled script: `bash supabase/deploy-functions.sh`)

Manage function secrets here if needed:
**https://supabase.com/dashboard/project/ufjkeqmxwuyhbqyugcgg/settings/functions**

Until this step is done, the email/SMS/AI/e-sign/QuickBooks functions and the
staff-invite/Stripe fixes stay on the old code. The database migration (Step 2)
already blocks the worst data-exposure issues, so Step 3 is important but less
urgent than Step 2.

---

## Step 4 — (Optional) Lock the scheduled jobs

To stop anonymous triggering of the daily-digest / email-scheduler cron
endpoints, set a `CRON_SECRET` in the function settings (link above) and add an
`x-cron-secret` header to the two pg_cron jobs. Low priority.

---

## What each step protects

| Step | Closes |
|------|--------|
| 1 (merge) | Stored XSS in the staff UI; data-loss on save; share-link client code |
| 2 (SQL)   | Cross-customer data access, fake payments, world-readable inspector tokens/booking PII, share-link enumeration |
| 3 (functions) | Self-promote-to-admin, $0.01 invoice payment, open email/SMS/AI/e-sign relays |
| 4 (cron)  | Anonymous triggering of scheduled emails |
