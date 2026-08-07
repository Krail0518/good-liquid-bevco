# Good Liquid Bev Co — working rules

Read this before changing anything. These are not style preferences; each one
exists because breaking it caused a real production security hole.

## What this system is

A **multi-tenant** system, and that word is the whole point:

- `index.html` + `crm-*.js` — the staff CRM **and** the public marketing site,
  served from one page. The repo root IS the home directory `C:\Users\mike`.
- `?portal=1` — the customer portal. **Real clients log in here.** They are
  competing beverage brands. One client seeing another's invoices, formulas or
  documents is the worst commercial outcome this system can produce.
- `onboard.html` — public, token-gated client intake.
- Supabase project `ufjkeqmxwuyhbqyugcgg` — Postgres + Auth + Storage + edge
  functions. `supabase/migrations/` is the schema history.

Ignore `C:\Users\mike\Downloads\good-liquid-bevco` — stale duplicate.

## The mistake that mattered most (do not repeat its shape)

On 2026-05-18 a migration granted every authenticated user full read/write on
every CRM table. Its header justified this explicitly: *"The CRM is
single-tenant (Good Liquid staff only); per-row ownership is not the threat
model here."*

That was true when written. **The customer portal shipped the same day** —
`20260518_customer_portal.sql` sits beside `20260518_rls_authed_all.sql` — and
nobody revisited the assumption. For months, any portal customer could read
every other client's data.

Separately, policies granting the anonymous role full access to fourteen tables
were applied **by hand in the Supabase dashboard**, so they appeared in no
migration. Reading the repo could never have found them; the entire database
was readable and deletable by anyone on the internet using the publishable key
that ships in the page source.

The lesson is not "be careful with RLS." It is:

> **A security decision is only as good as the assumption under it, and
> assumptions expire silently.** When you add a new class of user, re-audit
> every policy justified by "there is only one kind of user here."

## Hard rules

1. **Never write a permissive policy with `USING (true)`** for `anon`,
   `authenticated`, or `public`. Scope every policy to `public.is_gl_staff()`
   (staff = an active `profiles` row) or
   `client_id = public.current_customer_client_id()` (the customer's own rows).
2. **Never change database permissions through the Supabase dashboard.** Always
   a migration in `supabase/migrations/`, so it is reviewable and diffable. This
   is the single habit that would have prevented the worst finding.
3. **Constrain, don't rewrite.** To tighten a table that already has legacy
   permissive policies, add a `RESTRICTIVE` policy (they AND together) rather
   than trying to rewrite ~80 policies. See `20260807020000_tenant_isolation_guard.sql`.
4. **Check what the server actually did.** Every `.delete()` / `.update()` must
   append `.select()` and treat BOTH `error` and an empty returned array as
   failure. Row-level security rejects silently — 0 rows, no error — so
   unchecked writes report success while nothing saved. This produced ~40 bugs.
5. **Escape everything a lead or customer can type.** The CRM builds HTML by
   string concatenation. Brand name, contact name, notes, request bodies,
   filenames — all reach staff screens. Use the local `esc()`/`escHtml()`.
   A public quote form once let a stranger run script in staff sessions.
   `JSON.stringify(x).replace(/"/g,'&quot;')` is **not** an escape — the HTML
   parser decodes entities afterwards.
6. **Secrets live in Supabase secrets or `supabase/secrets.env`** (gitignored),
   never in `crm-*.js`, `index.html`, or a migration.
7. **Anything a stranger can trigger needs a rate limit** — public forms fire
   WhatsApp and email on every submission.
8. **Read `CRM_FEATURE_MAP.md`** before touching navigation, buttons, admin
   gates, or IIFEs.

## Before you say something is fixed

Run `bash scripts/security-invariants.sh`. It probes production from the
outside using only the public key, so it catches exactly the class of hole that
code review cannot: dashboard drift and accidental exposure. CI runs it on every
push and daily.

Then verify your actual change the same way — reproduce the problem, apply the
fix, reproduce again. Simulate a role with:

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
-- your query
rollback;
```

Test all three identities whenever you touch permissions: **staff** (should be
unchanged), **portal customer** (own client only), **self-registered stranger**
(nothing). Supabase signup is open, so the third one is a real attacker.

## Deploy

- Site: push to `main` → Vercel.
- Migrations: apply via the Supabase MCP `apply_migration`, and commit the file.
- Edge functions: `gh workflow run "Deploy Supabase"`. The local Supabase CLI
  token is expired; the CI secret works.
- Every migration gets a `ROLLBACK:` note at the top.
