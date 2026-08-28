# Technical Debt Register

Per the engineering standard §12. Each item carries severity, affected module,
business impact, recommended fix, and status.

**Source:** a 14-agent audit of `origin/main` on 2026-08-28, run across seven
dimensions (tenant isolation, silent writes, browser storage, injection, edge
functions, test coverage, release automation). Every finding was then given to a
separate agent whose job was to *refute* it. Four were killed outright and five
had their severity corrected; only survivors are listed here.

Severities are the post-verification values. Where the original grading was
wrong, the correction is stated in the notes.

## Status key

- **Fixed** — corrected and verified
- **Applied** — migration live in production
- **Accepted** — owner has accepted the risk; no action planned
- **Open** — not yet addressed

## Where this stands — 2026-08-28

| | |
|---|---|
| Findings recorded | 34 |
| Fixed, in an open PR | 13 |
| Migrations applied to production | 5 |
| Merged to `main` | 1 (#294) |
| Open PRs | 14, all CI-green |

**The gap between "fixed" and "merged" is the main risk right now.** Five
migrations are live on the database while three of the PRs carrying their files
are unmerged, so the migration history does not fully describe production. That
is the drift `CLAUDE.md` rule 2 exists to prevent, arrived at from the other
direction.

Two fixes also need an edge-function deploy, which a Vercel merge does not do:

| PR | needs |
|---|---|
| #296 | `booking-confirm` — rendering fix ships via Vercel, ingestion hardening does not |
| #307 | `stripe-checkout-session` — merge first, then deploy; the reverse 404s every pay attempt |
| #308 | `qbo-connect` **and** `qbo-callback` together — callback alone rejects every connect |

Run: `gh workflow run "Deploy Supabase"`

### Open PRs by finding

`#295` GL-001 · `#296` GL-XSS · `#297` scaffold + this register · `#298` GL-005 ·
`#299` GL-032 · `#300` GL-002 · `#301` GL-020 · `#302` GL-021 · `#303` GL-022 ·
`#304` GL-033 · `#305` GL-023/GL-024 · `#306` GL-010 · `#307` GL-003 · `#308` GL-004

`#301 → #302 → #303` are stacked and must merge in that order; the latter two
cannot run CI until #301 lands.

---

## Fixed / applied

| ID | Sev | Module | Issue | Business impact | Fix | Status |
|---|---|---|---|---|---|---|
| GL-001 | BLOCKER | `crm-auth.js` | The one-shot localStorage→DB settings migration deleted the local copies without ever writing them to `app_settings`, and set a guard flag so it could never retry. A seeded empty default (`sign_templates '{}'`) also masked three real values. | First admin login after deploy would silently lose the SMS recipient and alert phone, five notification toggles, Dropbox Sign template map, Stripe publishable key and Sentry DSN. Recovery meant re-entering each by hand. | Upsert before delete; abort cleanup on failure so it retries; treat empty seeds as absent. | **Fixed** — `fix/app-settings-data-loss`, 20 checks pass, 12 fail against pre-fix code |
| GL-F1 | BLOCKER | `handle_new_user()` | Signup trigger was a denylist: any auth user without portal metadata got an active `sales` profile. A bare `POST /auth/v1/signup` with the publishable key qualified. | An active profiles row *is* `is_gl_staff()`, which cleared the tenant guard and reached the legacy `USING(true)` policies — full CRUD on every table, `client-docs`, and `link_customer_user_by_email`. Portal customers are competing brands. | Inverted to an allowlist keyed on `auth.users.invited_at`, which the admin API sets and signup cannot forge. | **Applied** — `20260828175051`. Four-branch behavioural test in a rolled-back transaction; no account had used the hole |
| GL-F3 | MEDIUM | storage policies | `compliance-photos` carried `FOR ALL TO authenticated` with only a `bucket_id` test, plus an `anon` SELECT permitting enumeration. | Would give every portal customer full CRUD on FDA evidence — hold tags, defect photos, PCQI-signed documents. | Replaced with a staff-gated policy mirroring `client-docs`; dropped the anon policy. | **Applied** — `20260828180304` |
| GL-XSS | BLOCKER | `crm-calendar.js`, `booking-confirm` | Day panel concatenated `ev.title` / `ev.notes` into `innerHTML`. Those originate in the public tour-booking form. | A stranger books a tour with an `<img onerror>` name; script runs in a staff session — the origin holding the staff JWT. Same shape as the quote-form incident in `CLAUDE.md`. | Panel rebuilt with `createElement`/`textContent`; angle brackets stripped at ingestion across all 12 downstream uses. | **Fixed** — `security/calendar-stored-xss`. ⚠️ Test has not executed locally; CI is its first run |

**Correction on GL-F3:** first reported as live exposure. It was not — the
`compliance-photos` bucket does not exist (`storage.buckets` holds only
`client-docs`), so both policies were dangling with zero reachable objects.
It was latent, and downgraded accordingly. Hardened before the bucket exists so
it is safe by default.

## Accepted

| ID | Sev | Module | Issue | Business impact | Recommended fix | Status |
|---|---|---|---|---|---|---|
| GL-F2 | — | `profiles` | One account holds both an active staff profile and a `customer_users` portal link, created inside the window when the signup trigger wrongly gave every auth user a staff profile. | None. Owner confirmed 2026-08-28 that the account is his own, used for portal testing — not a customer. | None. Re-check if the account is ever handed to a real client. | **Accepted** |

## Open — security

| ID | Sev | Module | Issue | Business impact | Recommended fix | Status |
|---|---|---|---|---|---|---|
| GL-002 | HIGH | `index.html` | `saveRole` and `deactivateUser` call `renderPermissionsPanel()`, which is IIFE-local in `crm-permissions.js` and never exported. The `ReferenceError` throws *before* the `UPDATE`. | Role changes and deactivations never reach the database. A deactivated staff member can still sign in. Presents as a dead button, not a false success. | Move the render call after the write, or export the function; then adopt the `crm-auth.js:408` pattern — `.select()`, and treat a 0-row result as failure. | **Fixed** — #300 |
| GL-003 | HIGH | `stripe-checkout-session` | No caller authorization; looks up invoices with the service-role key by guessable sequential invoice number. | Anyone reaching the function can walk the invoice-number space and read every client's amount and payment status. | Require the invoice's `share_token` alongside the number. | **Fixed** — #307 |
| GL-004 | HIGH | `qbo-callback` | The OAuth `state` is read but never validated, and both QBO endpoints are unauthenticated. | The QuickBooks connection can be silently replaced by a stranger. | Validate `state` against a stored nonce; require staff auth. | **Fixed** — #308 |
| GL-005 | HIGH | `.github/workflows/apply-sql.yml` | Can run SQL against the production database from any branch; the path guard never checks the file was merged. | An unreviewed migration can reach production, bypassing the review gate entirely. | Restrict to `main`, require an environment approval. | **Fixed** — #298 |
| GL-006 | HIGH | `booking-confirm` | Interpolated attacker-supplied name/company/email into the approval email HTML while escaping `notes` in the same template. | Payload lands in the email carrying the Approve link. | **Partly addressed** by the GL-XSS ingestion strip; full fix is to escape at the template. | Open |
| GL-007 | MEDIUM | `stripe-webhook` | Requires `verify_jwt=false`, but neither deploy path configures it. | A routine redeploy silently breaks payment reconciliation. | Set it in `config.toml`. | Open |
| GL-008 | MEDIUM | `mailgun-webhook` | Signatures are verified but the timestamp is never checked. | Captured callbacks are replayable indefinitely. | Reject timestamps outside a short window. | Open |
| GL-009 | MEDIUM | `delete-staff-user` | Hand-rolled caller check omits the inactive-account guard. | A deactivated super-user can still hard-delete auth accounts. | Use the shared `requireStaff()` helper. | Open |
| GL-010 | MEDIUM | migrations | `capacity`, `case_studies`, `resources` still carry the 2026-05-18 `USING(true)` policy and sit outside the tenant guard. | Any authenticated user can edit or delete published marketing content. | Drop the three `authed all` policies, or add the tables to the guard. | **Applied** — 20260828221639, #306 |
| GL-011 | MEDIUM | migrations | `anon` holds `SELECT` grants on `formulas` and `yield_logs` with no policy justifying them. | Inert today, but the formula vault sits one stray policy from public — the exact shape of the 2026-05-18 incident. | `revoke select on public.formulas, public.yield_logs from anon;` | Open |
| GL-012 | MEDIUM | `gl_tour_intake_submit` | The `UPDATE` is scoped by email alone and does not exclude rows carrying a `client_id`. | An anonymous caller who knows a client's contact email can overwrite that client's stored formula/ingredient answers. | Add `and client_id is null` to the `WHERE`. | Open |
| GL-013 | LOW | migrations | A shared secret is hardcoded as a literal in a committed `vault.create_secret` call. | Substituting the real value in place would commit a live secret; leaving the placeholder means the trigger's calls are silently rejected. | Create the secret as a post-deploy step. | Open |

## Open — data integrity

| ID | Sev | Module | Issue | Business impact | Recommended fix | Status |
|---|---|---|---|---|---|---|
| GL-020 | HIGH | invoicing | Every "mark invoice paid" path writes AR status without `.select()` or a rows-affected check; one has no error handling at all. | RLS rejects silently — the UI reports success while nothing saved. `CLAUDE.md` attributes ~40 bugs to this class. | Append `.select()`; treat `error` **and** an empty array as failure. | **Fixed** — #301 |
| GL-021 | HIGH | `index.html` | Six delete paths check only `.error`, never rows-affected. | Deletes report success, purge the local cache, and write a false audit entry. | Same pattern as GL-020. | **Fixed** — #302 |
| GL-022 | HIGH | pipeline / clients | Deal, referral, referrer and client creation fall back to a browser-only synthetic id when the INSERT fails. | Business records exist only in that tab and vanish on reload. | Fail loudly instead of synthesising an id. | **Fixed** — #303 |
| GL-023 | HIGH | compliance | "Reset CCP limits to defaults" clears only the local cache; the DB override still wins. | FDA critical limits are never actually reset. | Delete the DB override. | **Fixed** — #305 |
| GL-024 | HIGH | admin tools | "Clear local cache" offers pre-checked deletion of legacy blobs that are still the only copy, labelled "safe to wipe". | Silent business-data loss initiated from a UI that says it is safe. | Migrate the blobs, or remove them from the default selection. | **Fixed** — #305 |
| GL-025 | MEDIUM | `crm-tools.js` | Service package pricing lives only in per-device localStorage; no table backs it. | Two staff can quote different prices for the same package with no indication. | Move to `app_settings` using the GL-001 mechanism. | Open |
| GL-026 | MEDIUM | CIP audit | A rejected DB write leaves an FDA-required CIP record in one browser's localStorage; the condition surfaces only as `console.warn`. `saveLocal()` is also dead code, so the fallback holds only stale data. | Operator believes a sanitation cycle was logged when it was not. | Surface the divergence in the UI with a retry; wire or remove `saveLocal()`. | Open |
| GL-027 | MEDIUM | compliance | `public.cip_logs` exists with RLS but no client code references it; the module uses `compliance_records`. An error message points debuggers at the unused table. | Wasted debugging time; ambiguity about the system of record. | Pick one table, record the decision in `docs/architecture/decisions/`. | Open |

## Open — architecture and process

| ID | Sev | Module | Issue | Business impact | Recommended fix | Status |
|---|---|---|---|---|---|---|
| GL-030 | HIGH | `.github/workflows` | The weekly AI review is an echo-only placeholder; `ci.yml` and `security-scan.yml` are unconditionally-green jobs running under trustworthy names. | The review gate the standard describes does not exist in executable form, while appearing to. | Implement per Setup Instruction #1, or delete the placeholders so they stop implying coverage. | Open |
| GL-031 | HIGH | deployment | Nothing prevents production deploy when the gate fails — Vercel auto-deploys on push to `main`. | A failing review cannot stop a release. | Branch protection + required status checks. | Open |
| GL-032 | HIGH | `scripts/security-invariants.sh` | Only ever authenticates as `anon`; never tests the `authenticated` role. | Cannot catch the 2026-05-18 class of hole it was written for. `CLAUDE.md` asks for all three identities. | Add a section signing in as a throwaway self-registered account, asserting zero rows from `clients`, `invoices`, `formulas`. | **Fixed** — #299 |
| GL-033 | HIGH | `tests/full-sweep.cjs` | Scores a missing global as PASS. | A module that stops loading turns 18 checks green. | Fail on absence. | **Fixed** — #304 |
| GL-034 | MEDIUM | tests | The `pageerror` noise filter swallows genuine app crashes. | Guts the "no fatal JS error" assertion in every browser test. | Narrow the filter to known-benign messages. | Open |
| GL-035 | MEDIUM | `.github/workflows` | The Tuesday deep-review cron `0 12 * * 2` is 08:00 EDT but 07:00 EST; no timezone configured. | Drifts an hour every winter. Setup Instruction #1 explicitly requires an intended timezone. | Run at `0 11,12 * * 2` and exit unless the local New York hour is 8. | Open |
| GL-036 | MEDIUM | `.github` | The AI-review issue template omits the release-blocking field and the STILL PRESENT re-review state; the PR template omits 7 of the 15 §15 checklist items. | The remediation loop has no field to gate on. | Add the missing fields. | Open |
| GL-037 | MEDIUM | architecture | 304 distinct `window.*` globals form the real module interface; `crm-compliance.js` is 4,590 lines. | §3 names this directly. Highest-blast-radius area for unintended effects; compliance is where the manual test plan says bugs keep surfacing. | Extract into `src/modules/` one capability at a time behind a PR. **Not a bulk move** — `index.html` hardcodes ~37 order-dependent root-absolute script tags and Vercel serves from the repo root. | Open |
| GL-038 | LOW | product | The `compliance-photos` bucket has never been created, so hold-tag photos, defect photos and PCQI document signing all fail. | A documented compliance feature does not work. | Create the bucket. Public vs private changes which URL API the client needs — `getPublicUrl()` today implies public. | Open |
