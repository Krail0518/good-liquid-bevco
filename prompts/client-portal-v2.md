# Client Portal v2 — build prompt

Paste this whole file as your opening message to Claude.

---

## Task

Extend the existing Good Liquid customer portal (`?portal=1`) into a project-status
portal: clients log in, see where their project stands, get approved materials,
respond to what we need from them, and discover services they have not bought.

**Do not begin implementation.** Read the repo, verify the claims in the "What is
already there" section below against the live database, then come back with the
plan described under "What to deliver." Wait for my approval.

## Ground rules

Read `CLAUDE.md` first and treat it as binding — especially the RLS incident at the
top. This portal is the exact shape of that incident: it is the second class of
user, and it is the reason single-tenant assumptions elsewhere expire.

Non-negotiable, from that file:

- No `USING (true)` for `anon`, `authenticated`, or `public`. Scope to
  `public.is_gl_staff()` or `client_id = public.current_customer_client_id()`.
- No permission changes through the Supabase dashboard. Migration files only.
- Constrain, don't rewrite: tighten tables with a `RESTRICTIVE` policy that ANDs
  with the legacy permissive ones. See `20260807020000_tenant_isolation_guard.sql`.
- Every `.delete()` / `.update()` appends `.select()` and treats an empty array as
  failure, not just `error`.
- Escape everything a client can type, with the local `esc()` / `escHtml()`.
- Rate-limit anything a stranger can trigger.
- Read `CRM_FEATURE_MAP.md` before touching nav, buttons, admin gates, or IIFEs.
- Every migration gets a `ROLLBACK:` note at the top.

## What is already there — verify, don't rediscover

I inspected this on 2026-09-14. Confirm each line before relying on it; say so if
any has drifted.

**Stack.** There is no framework, no bundler, no package.json, no router, no ORM,
no linter, no type checker, no build step. `index.html` is one page carrying the
marketing site, the staff CRM and the portal, with ~93 order-dependent
root-absolute `<script>` tags. Vercel serves the repo root. Each file is an IIFE
publishing `window.gl*` globals. Match that. `src/modules/` is a migration target,
not a filing cabinet — extract one capability at a time.

**CSP** (`vercel.json`): `script-src 'self'` plus jsdelivr, cdnjs, sentry-cdn,
googletagmanager. A new runtime dependency means a CSP change — propose it
explicitly or do without. Inline handlers are capped by
`tests/inline-handler-budget.test.cjs`; wire behaviour through the
`data-gl-action` registry in `src/shared/action-registry.js` and `actions.js`.

**Tests** are standalone static-analysis scripts: `node tests/<name>.test.cjs`,
wired one-per-step into `.github/workflows/smoke-test.yml`. New tests follow that
shape and get added to that workflow. `tests/security/`, `tests/integration/` and
`tests/regression/` currently hold only a README.

**Portal surface.** `?portal=1`. Gate in `src/modules/customers/portal.js`, public
shell in `portal-public.js`, the dashboard in `portal-customer.js` (1,324 lines,
one scrolling page, no tabs). It already renders: login/waiting states, 3 KPIs
(open balance, paid to date, total invoices), four request tiles (sample, reorder,
quote, question) writing to `customer_requests`, production runs with carrier
tracking, lot documents, invoices with PDF download, an "🔒 AGREEMENTS &
CONTRACTS" section over `deal_documents` with download + customer upload, an
artwork section, and account settings including teammate management.

**Auth.** Supabase Auth; **signup is open**, so a self-registered stranger is a
real identity you must test. `customer_users` = `(id, auth_user_id, client_id,
email, display_name, active, invited_by, invited_at, last_login,
notify_run_stage_changes, role)`. Staff admin for it lives in the same file
(`glInviteCustomerLogin`, `glCpSetActive`, `glCpSetRole`).

**Authorization.** `is_gl_staff()` = an active `profiles` row.
`current_customer_client_id()` = `select client_id from customer_users where
auth_user_id = auth.uid() and active = true limit 1`. Isolation is enforced by a
RESTRICTIVE policy named `gl tenant guard`, `is_gl_staff() OR client_id::text =
current_customer_client_id()::text`, present on at least: `clients`, `invoices`,
`formulas`, `production_runs`, `sample_shipments`, `deal_documents`,
`client_artwork`, `customer_requests`, `lot_documents`,
`client_allergen_declarations`, `customer_users`.

**Files.** Three private buckets: `client-docs` (the portal one),
`compliance-photos`, `sales-decks`. The `client-docs customer read` policy allows
an object when its name is prefixed `<client_id>/` **or** a `deal_documents` /
`lot_documents` row with that `file_path` belongs to the caller's client. Access
is via 60-second signed URLs. That is already the right pattern — reuse it, do not
invent a second one.

### Five things the draft spec assumed that are not true

State your plan for each in your response.

1. **There is no project entity.** 91 tables, none called `projects`. The closest
   things are `deals` (pre-sale pipeline), `production_runs` (a single run),
   `formulas`, `product_intake`, `onboarding`, `quotes`. `deals` are *leads*, not
   projects — only 1 of 64 has a `client_id`, and the stages are sales stages
   (`Prospecting`/`Proposal`/`Negotiation`/`Closed Won`/`Closed Lost`), not
   development stages. **DECIDED: build a real `projects` table.** A client has
   several concurrent projects (a brand launching a lemon-lime and a ginger SKU on
   separate timelines), and each carries its own milestone set.
2. **A user belongs to exactly one client.** `customer_users.client_id` is a
   single column and the helper ends in `limit 1`. Multiple companies per user is
   not a feature to switch on — it means a join table, a rewritten
   `current_customer_client_id()`, and touching every `gl tenant guard` policy.
   That is the highest-risk change available here. Do not do it in phase 1.
3. **There is no milestone, service, or entitlement table.** All three are new.
4. **`deal_documents` has no visibility column** — so today every agreement
   document attached to a client is already visible in their portal. Likewise
   `formulas` are already exposed to portal customers at any status except
   `draft`. Both predate this work. Tell me whether to tighten them as part of
   phase 1 and what that would hide from people who can see it now.
5. **`formulas.client_id` and `production_runs.client_id` are `text`**, not
   `uuid`, while everything else is `uuid`. The guard policies cast around it. Any
   new foreign key touching those tables hits this. Propose a fix or a way around
   it; do not silently cast.

## Decisions — my answers

Everything marked DECIDED is settled — build it, don't re-open it. `[DEFAULT]`
means I picked a sensible answer without much thought; challenge it if the repo
says otherwise, but don't block on it.

- **Milestones:** DECIDED. These 13, in order: intake · formulation · internal
  testing · sample prep · sample sent · client feedback · formula revisions ·
  formula approved · awaiting PA letter · PA letter obtained · packaging/artwork ·
  production ready · complete.
- **Milestone configuration:** DECIDED. A global default template stamped onto
  each project at creation, editable per project afterwards. Not per project-type.
- **The revision loop:** DECIDED. `sample sent → client feedback → formula
  revisions → sample sent` is a cycle, not a line. The tracker shows the round
  number — "Sample sent — round 3". The schema must therefore support a milestone
  being entered more than once; a single `completed_at` per milestone row will not
  express this. Model the rounds, don't flatten them.
- **The artwork track:** DECIDED. Packaging/artwork runs *parallel* to
  formulation, so it does not belong in the single left-to-right bar — that would
  show a client at 60% while artwork sits untouched. One honest progress bar for
  the formulation track, artwork as its own separate indicator. This is a hard
  requirement, not a style note: the spec says no misleading progress, and a
  flattened bar is exactly that.

  The artwork track is **two-way**, and the direction is the reverse of the rest
  of the portal: the *client* uploads the artwork, *Good Liquid* approves it, then
  it goes to the printer. Roughly: `client uploads → in review → changes
  requested → approved → sent to printer`. Confirm the states with me. Client
  uploads already work — `client_artwork` has customer insert/read policies, an
  `artwork.js` module, and 7 live rows.

  **Read this before touching `client_artwork` — verified 2026-09-14.** The table
  has a policy `client_artwork customer update` with
  `USING/WITH CHECK (client_id = current_customer_client_id())` and **no column
  restriction**, plus `client_artwork customer delete` on the same terms. All 7
  rows are `status = 'submitted'`. That is fine while `status` is a label the
  client sets about their own upload. It stops being fine the moment `status`
  means "Good Liquid approved this for print": a customer can then set
  `status = 'approved'` from the browser console and a delete can destroy the
  record of an approval that authorised a print run.

  This is the CLAUDE.md incident in a new costume — a policy that was correct
  under an assumption ("status is the client's own label") that your feature
  silently expires. So:

  - The approval decision must live where a customer cannot write it. Prefer a
    separate staff-write-only table of immutable decision rows (actor, artwork id,
    file version, decision, timestamp) over a mutable `status` column — follow the
    GL-068 compliance-signature immutability pattern.
  - If you keep any staff-meaningful column on `client_artwork`, restrict customer
    writes at the **column** level (`GRANT UPDATE (col, …)` after revoking the
    blanket grant) and back it with a trigger. A RESTRICTIVE policy cannot express
    "this column did not change" because `WITH CHECK` cannot see the old row.
  - Re-examine the customer DELETE policy. A client removing their own draft
    upload is reasonable; removing an artwork record that a print run depends on
    is not. Propose the narrower rule.
  - Prove all of it: a test asserting a portal customer cannot approve their own
    artwork, and cannot delete an approved record. Run it as the real
    `authenticated` role, not as staff.
- **Who moves a milestone:** `[DEFAULT]` staff set it by hand from the CRM. You
  may *suggest* a next state from existing fields (`clients.formulation_done`,
  `clients.pa_letter_on_file`, `production_runs.stage`, `sample_shipments`) but
  never auto-advance — the suggestion is a nudge with a confirm, never a write.
- **Projects:** DECIDED. New `projects` table, several live per client, each with
  its own milestone set stamped from a template. The portal shows a project picker
  when a client has more than one.
- **Layout:** DECIDED. The portal becomes **tabbed**. Today `portal-customer.js`
  is a single scrolling page with no tabs — this is a restructure of that file,
  not an addition to it. Locked tabs must be visible next to unlocked ones; that
  visible-but-locked surface is the whole sales mechanic, so the tabs have to be
  real navigation. Tab order: Overview · Documents · Formula · Samples & Orders ·
  **Renders** · **Packaging & Artwork** · **Market Analytics** · Billing. Bold =
  entitlement-gated.
- **Formula visibility:** DECIDED, and this is the tightest constraint in the
  build. The Formula tab shows **status plus deliberately published documents**:
  - Always visible: name, version, stage, updated date, the version timeline.
  - **Never**: ingredients, percentages, suppliers, process steps — not as
    columns, not in an API response, not in page source.
  - Staff may attach a document to a specific formula version and publish it to
    the client **one file at a time**. Nothing is client-visible by default;
    publishing is always an explicit act.
  - Because a published spec sheet or COA *can* contain the formulation, the
    publish control is the security boundary. It gets a confirm step naming the
    file, an `audit_log` row recording who published what to which client, and a
    log of client downloads. Signed URLs only, matching the existing 60s pattern.
  - `formulas` is currently empty (0 rows), so tightening the existing
    `.neq('status','draft')` exposure in `portal-customer.js:280` costs nothing.
    Do it in the same migration.
- **Entitlements:** DECIDED. A new entitlements table is the single source of
  truth for what unlocks; the UI never hard-codes it and never decides it from a
  string match. In phase 1 **staff tick the boxes by hand** — plain checkboxes
  (renders ✓, artwork ✗, analytics ✗) on the record, no workflow around them.

  They hang off the **project, not the client**. A brand may buy renders for its
  launch SKU and not for the second flavour, and a client-level flag cannot say
  that — it would unlock the tab on every project at once. Project-level can be
  granted across all of a client's projects; client-level cannot be narrowed later
  without a migration. Granting the same entitlement to every project of a client
  should be one action in the CRM, not N clicks.

  The quote builder writes to that same table in a later phase — do not build that
  now, but do not design the table in a way that prevents it.

  Verified 2026-09-14, and this is *why* it is manual: all 3 `quotes` rows are
  `status = 'draft'` (there is no accepted state in the data), only 1 of 12
  clients has a quote at all, and `quotes.addons` holds production add-ons
  (Nitrogen Dosing, Tray/PakTech, Palletizing, Batch Flash Pasteurization) priced
  per can. **Nothing in the quote builder sells renders, artwork or analytics.**
  Deriving entitlements from quotes today is not possible, not merely awkward.
- **Locked services:** DECIDED. No direct checkout. The CTA creates a
  `customer_requests` row and notifies staff — reuse that existing flow rather
  than building a second one. A locked tab still renders something worth reading:
  what the service is, why it helps this project, a representative preview, and
  the CTA. It must never look broken or disabled-grey; this surface is the point.
- **Client actions in phase 1:** `[DEFAULT]` upload a file, submit feedback,
  approve a formula, approve artwork, request a service. Signatures, payments,
  questionnaires: later.
- **Approvals** write an immutable audit row — actor, action, item, version,
  timestamp. Follow the pattern in `20260811...` compliance-signature immutability
  (GL-068) rather than inventing one.
- **Notifications:** `[DEFAULT]` in-app only for phase 1, using the existing
  `notifications` table. Do not build a third channel — there is already that
  table (staff-facing) and an `email_log` with 1,901 rows. If email is genuinely
  cheap because the existing sender covers it, say so and I'll decide; do not
  assume it.
- **Existing exposures to close:** `[DEFAULT]` `deal_documents` has no visibility
  column, so all 30 rows are portal-visible today. Add the column defaulting the
  **existing** rows to visible (they have already been seen; silently retracting
  them is its own kind of wrong) and **new** rows to internal. Flag this in your
  plan — if you think the safer default is to hide all 30 and let me re-publish,
  argue for it.
- **Portal roles:** `[DEFAULT]` `customer_users.role` (`owner`/`member`) stays a
  purely administrative distinction — it gates teammate management and account
  settings, nothing else. Both roles see the same project data, documents and
  billing. Do not quietly turn it into a data-visibility gate.
- **When a project starts:** `[DEFAULT]` staff create it manually from the client
  record. Do not wire it to deal-convert in phase 1.
- **Staff controls:** milestone editing, publishing a client-visible status
  update, flagging a file client-visible, and managing entitlements all belong in
  the existing client edit form, not a new admin page. "Preview as client" is
  wanted — propose the safest way to do it.

## What to deliver, before any code

1. Corrected summary of the architecture — say plainly where my spec was wrong.
2. The tables, policies, modules and storage paths this will touch.
3. Your questions, especially anything above you think I got wrong.
4. Recommended phase-1 scope, and what you are deliberately cutting.
5. Proposed data model: new tables, columns, indexes, constraints, and the exact
   `RESTRICTIVE` policy text for each.
6. Authorization approach, including what happens to a self-registered stranger.
7. File-security approach — where new objects live in `client-docs` and how the
   visibility flag is enforced in the *storage* policy, not just the query.
8. Internal CRM changes, and how internal content stays separated from
   client-visible content.
9. Module/script-tag plan: new files, where they go in the `index.html` order, and
   why that order is safe.
10. Migration and backward-compatibility notes, including the `ROLLBACK:` plan and
    whether anything here worsens the GL-057 replay problem.
11. Test plan. It must include a test proving one client cannot read another's
    projects, milestones, files or formulas, and a test that internal-only fields
    never reach a client response.
12. Risks needing my sign-off.
13. Phased plan with a shippable phase 1.

## Definition of done, per phase

- `bash scripts/security-invariants.sh` passes.
- New `tests/*.test.cjs` added and wired into `.github/workflows/smoke-test.yml`.
- Behaviour verified live as all three identities — staff, the client's own portal
  user, and a self-registered stranger — using the `set local role` /
  `request.jwt.claims` recipe in `CLAUDE.md`. Reproduce, fix, reproduce.
- Migrations applied via the Supabase MCP `apply_migration` and the file committed.
- No existing CRM behaviour changed without being called out.
