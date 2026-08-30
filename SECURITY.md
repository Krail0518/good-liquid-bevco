# Security Model — Good Liquid Beverage Co. CRM

> Last updated: 2026-05-24  
> Questions / vulnerability reports → email the system owner directly (not a public channel).

---

## 1. Architecture overview

```
Browser (index.html + fix.js)
    │
    ├── Supabase JS client  ─────►  Supabase REST / Realtime
    │                                 ├── Postgres (RLS enforced)
    │                                 └── Edge Functions (server-side secrets)
    │
    ├── Stripe.js           ─────►  Stripe Checkout / Webhooks
    └── Mailgun             ─────►  via mailgun-send Edge Function only
```

The app is a **client-rendered SPA** served as a static file. There is no server-side rendering layer. All business logic that touches sensitive data goes through either:
- **Supabase Postgres** (Row-Level Security on every table), or
- **Supabase Edge Functions** (server-side, secrets never leave the function).

---

## 2. Authentication

| Mechanism | Details |
|---|---|
| Provider | Supabase Auth (email + password) |
| Session storage | Supabase-managed `localStorage` JWT (short-lived; auto-refreshed) |
| Multi-factor authentication | TOTP via Supabase Auth MFA — users enroll via **AI Settings → Two-Factor Auth** |
| Password policy | Minimum 8 characters, at least one uppercase letter and one special character (enforced in `fix.js` `checkPw`) |
| Login IP alerts | On every sign-in a `login_events` row is inserted. If the IP is new for that user, an in-app banner and email are fired immediately |
| Session termination | Sign-out calls `supa.auth.signOut()` which invalidates the JWT server-side |

---

## 3. Authorization — role model

Three roles are enforced at **both** the UI layer (page visibility) and the database layer (RLS):

| Role | Page access | DB access |
|---|---|---|
| `viewer` | Dashboard, Clients, Invoices, Activity | SELECT only on allowed tables |
| `sales` | All viewer pages + Pipeline, Calendar, Production, Samples, Formulas, Content, Tasks, Reports | SELECT + INSERT + UPDATE |
| `admin` | All pages | SELECT + INSERT + UPDATE (DELETE blocked by RLS — super only) |
| `super` (flag in `profiles`) | All pages | All verbs including DELETE |

The `admin` role in Supabase Auth (`app_metadata.role = 'admin'`) is **not** the same as the `is_super_user` flag. A regular admin cannot DELETE records or grant permissions to other users.

Key DB functions:
- `public.is_staff_user()` — returns true for any authenticated user with a valid `profiles` row
- `public.is_super_user()` — returns true only when `profiles.is_super_user = true` for the calling user

Both functions are `SECURITY DEFINER` and cannot be spoofed by the JS client.

---

## 4. Row-Level Security (RLS) policy map

RLS is enabled on every table. The pattern applied across the schema:

```
SELECT  → is_staff_user()   (staff and above)
INSERT  → is_staff_user()
UPDATE  → is_staff_user()
DELETE  → is_super_user()   (super only — prevents mass-delete from DevTools)
```

Special cases:
- **`audit_log`** — SELECT + INSERT only; no UPDATE or DELETE policy exists. Rows are immutable even to the super user via the JS client. Purging requires the Supabase dashboard service-role key.
- **`permission_components`** — READ open to authenticated; WRITE super-only.
- **`user_permissions`** — READ: self or super; WRITE: super only. Prevents privilege escalation via `upsert` from DevTools.
- **`login_events`** — INSERT: self; SELECT: self or super; no UPDATE or DELETE.
- **`inspector_tokens`** — tight RLS; tokens expire server-side; used only for the read-only inspector mode.

---

## 5. Secret management

| Secret | Location | Access |
|---|---|---|
| Supabase publishable key (`sb_publishable_…`) | `src/services/auth.js` (public, ships in page source) | Safe by design — the security model assumes an attacker has it, which is why `scripts/security-invariants.sh` probes production *using* it |
| Mailgun API key | Supabase Edge Function secret (`MAILGUN_API_KEY`) | Never in the browser |
| Anthropic API key | Supabase Edge Function secret (`ANTHROPIC_API_KEY`) | Never in the browser |
| Stripe secret key | Supabase Edge Function secret | Never in the browser |
| Twilio credentials | Supabase Edge Function secret | Never in the browser |

The `supabase/migrations/` directory is safe to commit — it contains only DDL and RLS policy SQL, no secrets.

---

## 6. Content Security Policy

Enforced via `vercel.json` on every response:

```
default-src 'self'
script-src  'self' cdn.jsdelivr.net cdnjs.cloudflare.com
            browser.sentry-cdn.com www.googletagmanager.com
style-src   'self' 'unsafe-inline' fonts.googleapis.com   (fallback only)
style-src-elem 'self' fonts.googleapis.com
style-src-attr 'unsafe-inline'
font-src    'self' fonts.gstatic.com
connect-src 'self' *.supabase.co wss://*.supabase.co sentry.io api.ipify.org
frame-src   'self' js.stripe.com hooks.stripe.com
object-src  'none'
upgrade-insecure-requests
```

`script-src` no longer carries `'unsafe-inline'` (removed 2026-08-29, GL-DEF-01).
Getting there took more than deleting the token, because that allowance covers
three separate things:

- **134 inline `on*` handlers** across 26 files, replaced by a delegated
  dispatcher with a 301-name allowlist (`src/shared/actions.js`). The allowlist
  is the security gain: a converted control can reach only what is registered,
  where an inline handler could call any global on the page.
- **6 inline `<script>` blocks** (~1,072 lines) on the five secondary pages,
  moved verbatim to external files.
- **29 `javascript:` URLs**, 8 of which were built at runtime and so invisible
  to any scan of the markup — including a functional `location.reload()`
  recovery link.

`tests/csp.test.cjs` fails if `'unsafe-inline'` returns while nothing justifies
it, and `tests/inline-handler-budget.test.cjs` fails if the handler count rises
above zero.

`style-src` is split, and the two halves are deliberately different.

`style-src-elem` is strict. Every style ELEMENT is an external file now: 7
inline `<style>` blocks in the pages, 10 `document.createElement('style')`
calls, and 11 blocks generated into print and report popups. That last group
mattered because a `window.open('')` document inherits the opener's CSP, so
those blocks are governed too — checked against production rather than assumed.
They are `<link>`s at `location.origin` now; a popup is same-origin.

`style-src-attr` keeps `'unsafe-inline'` and is not going to lose it soon.
The CRM builds roughly 6,000 `style="..."` attributes, and no nonce or hash can
cover a style attribute — only `'unsafe-inline'` does. Removing it means
converting them all to classes.

The split is worth having because the halves are not equally dangerous. A
`<style>` element can carry attribute selectors, which is how CSS is used for
keylogging and exfiltration. A style attribute applies only to the element it
sits on and cannot select anything.

Plain `style-src` is left permissive underneath both, on purpose: Firefox
before 122 ignores the specific directives and reads it, so tightening it would
break inline style attributes on those browsers instead of protecting anyone.

Additional headers set: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation off).

---

## 7. Known risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Compromised admin account grants permissions via DevTools | Medium | `user_permissions` writes blocked by RLS to super-only. Even if escalated in the UI, destructive ops (DELETE) still require `is_super_user()` at the DB layer |
| Mass-delete via DevTools (`supa.from('clients').delete()`) | High | Every critical table requires `is_super_user()` for DELETE. An admin's DELETE call returns a 403 from Postgres |
| Stolen Supabase anon key | Low | Anon key alone cannot read or write any table — RLS requires a valid JWT |
| Insider threat (admin user deletes their own records) | Medium | All writes flow through `audit_log`. Audit rows are immutable. Super user can investigate and restore from Supabase point-in-time backup |
| Session fixation | Low | Supabase Auth issues new JWTs on login; old tokens are invalidated server-side on sign-out |
| XSS leading to token theft | Medium | CSP limits script execution to known CDNs. `HttpOnly` is not applicable (browser-managed JWT). MFA enrollment limits post-theft account takeover window |
| New sign-in from unknown IP | Low–Medium | `login_events` + email + in-app banner alert the account holder immediately |

---

## 8. Incident response checklist

1. **Suspected account compromise** — Super user sets `is_super_user = false` on the affected profile, then changes their password from the Supabase Auth dashboard. Review `audit_log` and `login_events` for the affected `user_id`.
2. **Mass data deletion** — Supabase point-in-time recovery (PITR) can restore to any second in the retention window. Check `audit_log` to scope the damage.
3. **Leaked secret** — Rotate the secret in Supabase Edge Function settings (`supabase secrets set KEY=value`). The old key is invalidated immediately; the frontend needs no change.
4. **Suspected SQL injection** — All Supabase JS calls use parameterised queries via the PostgREST API. Manual SQL is only in migrations (not user input). Risk is low, but audit any new `rpc()` calls that accept user strings.

---

## 9. Hardening backlog (future work)

- [x] Remove `'unsafe-inline'` from `script-src` — done 2026-08-29 by eliminating
      every inline handler, inline `<script>` block and `javascript:` URL, rather
      than by adding nonces. Nothing needs a nonce because nothing is inline.
- [x] Do the same for `style-src-elem` — done 2026-08-30 by moving all 28
      style elements (7 page blocks, 10 runtime injections, 11 generated into
      popups) into stylesheets. Verified by serving the real CSP locally and
      confirming an inline `<style>` no longer applies while a linked one does.
- [ ] `style-src-attr` still needs `'unsafe-inline'` for ~6,000 `style="..."`
      attributes. No nonce can cover a style attribute, so this one only moves
      by converting them to classes.
- [ ] Add CAPTCHA on the login form to slow credential stuffing
- [ ] Set up Supabase Auth rate-limiting (already on by default for SaaS plan; verify for self-hosted)
- [ ] Periodic review of `login_events` for anomalous patterns (many new IPs, off-hours logins)
- [ ] Evaluate Supabase Vault for additional secret rotation automation
