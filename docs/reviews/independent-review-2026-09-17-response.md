# Response to the independent implementation review of 17 September 2026

Reviewer's scope: the CP01–CP10 portal corrections and the GL-101 payment
changes, at head `c741892`. Three HIGH and three MEDIUM findings. All six are
fixed and deployed. This document says, per finding, what changed and **what
kind of evidence** exists for it, because the reviewer's closing point is the
right one: "implemented", "source-verified", "behaviourally tested" and
"accepted" are four different claims and the completion report should not blur
them.

Grades below are the reviewer's own, except R3, where I agree with their note
that the mechanism is real but cannot cross tenants; the register carries it as
MEDIUM with their HIGH recorded beside it.

## Evidence vocabulary

| Term | Means |
|---|---|
| **Implemented** | The change is in `main` and applied/deployed to production. |
| **Source-verified** | A test asserts the source says the right thing. Catches a regression in the code; proves nothing about the running system. |
| **Behaviourally tested** | The shipped code or the live database was executed and observed. Named per finding below. |
| **Accepted** | The owner has exercised it in the product. **None of the six are accepted yet** — see "What still needs the owner". |

## The six findings

### R1 (HIGH) — an unpaid ACH checkout was recorded as a payment · GL-119

`checkout.session.completed` was treated as proof of payment. A bank debit
arrives with `payment_status: unpaid` while it is still processing, and the two
async events were not handled at all, so an invoice could be marked paid before
the money arrived and stay paid after the debit failed.

Now: settle only when the session itself reports `payment_status = 'paid'`
(from `completed` or `async_payment_succeeded`), keyed on the **checkout
session**, because one ACH payment arrives as two events and an event-keyed
ledger cannot tell a redelivery from a second settlement.
`async_payment_failed` reverses any payment recorded for that session through
the new `gl_reverse_stripe_session`, under the invoice row lock.

- Behaviourally tested: `tests/stripe-webhook-behavior.test.cjs` — 26 checks
  driving event sequences through the exact `settlement.mjs` the deployed
  function imports, including a mutant that ignores `payment_status` (the
  scenario catches it). `scripts/stripe-settlement-proof.sql` — 14/14 against
  production, rolled back. The bundled `index.ts` was also replayed locally with
  signature-verified events: an unpaid `completed` makes **no** ledger call.
- Deployed: `stripe-webhook` v51 (CI-built entrypoint).
- **Owner action:** the Stripe endpoint must be subscribed to
  `checkout.session.async_payment_succeeded` and
  `checkout.session.async_payment_failed`. Without them an ACH invoice will now
  never be marked paid. I cannot read or change the Stripe dashboard.

### R2 (HIGH) — concurrent partial refunds overstated reversals · GL-120

The cumulative-to-delta subtraction happened between two HTTP requests with no
lock, so two refund events at once both read "nothing refunded yet".

Now: `gl_apply_stripe_refund` takes Stripe's cumulative figures and does the
subtraction after `select … for update` on the invoice. Out-of-order events
compute a negative delta and record nothing. Non-applied verdicts are handled
explicitly; an HTTP 200 with no readable verdict is treated as failure.

- Behaviourally tested: the reviewer's own example ($103 charge, $100 base,
  cumulative $20.60 then $30.90) ends at **$30 reversed in both orders**, with
  redelivery and a full refund to exactly zero — live, rolled back.
  `scripts/stripe-refund-concurrency.sh` runs two real database sessions: the
  second waited ~4.4 s on the first's lock against a 6 s hold (solo baseline
  2.7 s). Nothing is written: both roll back and the probe refunds $0.

### R3 (MEDIUM; reviewer HIGH) — hidden or archived uploads re-exposable · GL-121

Storage grants a read when **any** visible, non-archived row names the object,
and the customer INSERT policies accepted any path inside the client's own
`/portal/` folder. Registering a second row undid a staff hide, an artwork
archive or a project archive, and did not require the caller to be the uploader.

Now: `gl_claim_customer_upload`, a BEFORE INSERT trigger on both
customer-insertable tables. For end-user, non-staff callers the object must be
one **this user uploaded** and must not already be registered in
`deal_documents`, `client_artwork` or `lot_documents` — every table the storage
read policy trusts. Serialised per path on an advisory lock. Staff and service
writes are unaffected, so explicit staff publication still works.

- Behaviourally tested: `scripts/portal-upload-alias-proof.sql`. **Before** the
  fix, run against production: 7 of 7 aliases accepted and 3 hidden files
  readable again — the finding reproduced exactly. **After**: 9/9, every alias
  refused, files unreadable, foreign-owner registration refused, revisions and
  legitimate uploads still work, stranger refused. `portal-isolation-proof.sql`
  still 20/20.
- Not executed: two aliases inserted from parallel sessions. The advisory lock
  serialises them by construction; one transaction cannot demonstrate it.

### R4 (MEDIUM) — service emails did not re-check the entitlement · GL-122

The queue row stored only the project id, so the send-time gate could not tell
whether the announced services were still granted.

Now the announcement records `services: [...]` and the gate requires each one's
latest ledger event to be a `grant`, naming any that are not. A partly revoked
announcement is **skipped, not rewritten**: its text says all of them are open.
Rows with no service list (queued before this change) are skipped as
unverifiable; production had none pending.

- Behaviourally tested: `scripts/service-email-recheck-proof.sql` — 8/8 live,
  rolled back, and the scheduler is never invoked, so no email is sent. Before
  the fix the same script showed "no block" after a revoke.

### R5 (MEDIUM) — staff artwork revisions lost their project · GL-123

The revision took its project from the screen. The staff view has no project, so
staff revisions fell into "unassigned"; in the portal, revising unassigned
artwork while a project was open filed it under that project. Revision mode also
survived a project switch and could not be cancelled.

Now: the screen takes the parent's project, clears revision mode on every
render, and offers Cancel revision. The database enforces the same rule for any
caller: an INSERT with `supersedes_id` must carry the parent's project.

- Behaviourally tested: `scripts/artwork-revision-project-proof.sql` — 7/7 live
  (4 wrong-project revisions were accepted before the fix), staff and customer.
  `tests/artwork.test.cjs` adds four real-screen scenarios covering the staff
  mount, the portal case, a project switch and cancelling.

### R6 (MEDIUM) — Preview as client used stale milestone data · GL-124

The date and owner handlers saved but never updated the cache that "Preview as
client" and "Add new round" read.

Now the cached milestone takes the value the **server returned**, and a refused
or failed save puts the control back to the last saved value with the reason
shown. No re-render, so the user keeps their place.

- Behaviourally tested: new `tests/projects-admin-cache.test.cjs` drives the real
  page and the real action dispatcher — save, preview, add round, plus a refused
  save and an erroring save.

## On the reviewer's other points

- **"The regression suite is largely source-pattern assertions."** Fair, and it
  is why neither R1 nor R2 was caught. The new tests execute code: the Stripe
  suite imports the module the function imports, the two browser suites drive
  the real screens, and four SQL proofs run against production and roll back.
  The source-pattern checks are kept, but they are now the smaller half.
- **"A green DB-drift result is not proof of behavioural equivalence."** Agreed.
  The baseline is regenerated with each migration (932 facts) and is evidence
  about grants, security mode and search_path only. Function bodies are covered
  by the proofs above.
- **Historical payment impact.** The CRM ledger holds no Stripe row and never
  has; all 19 payment rows are checks, manual entries or the legacy backfill. As
  the reviewer says, that cannot establish that no customer was charged — only
  Stripe-side reconciliation can, and that needs the owner.

## What still needs the owner

1. Subscribe the Stripe webhook endpoint to the two async checkout events (R1).
2. A real Stripe payment and refund end to end, including an ACH payment, which
   is the only way to close R1/R2 as *accepted*.
3. A signed-in customer browser session: upload, hide, and confirm the file is
   gone from listing, signed URL and download (R3 acceptance).
4. Send one real service announcement and confirm inbox delivery (R4).
5. Stripe-side reconciliation of any historical charges.
6. Still open from before this review: the two Atlas documents, a qa-playwright
   admin account, password settings, and GL-065 / GL-066 / GL-069.

## Where the evidence lives

| Finding | Source checks | Behavioural evidence |
|---|---|---|
| R1 | `tests/payment-ledger.test.cjs` | `tests/stripe-webhook-behavior.test.cjs`, `scripts/stripe-settlement-proof.sql` |
| R2 | `tests/payment-ledger.test.cjs` | same, plus `scripts/stripe-refund-concurrency.sh` |
| R3 | `tests/portal-corrections.test.cjs` | `scripts/portal-upload-alias-proof.sql`, `scripts/portal-isolation-proof.sql` |
| R4 | `tests/portal-corrections.test.cjs` | `scripts/service-email-recheck-proof.sql` |
| R5 | `tests/portal-corrections.test.cjs` | `scripts/artwork-revision-project-proof.sql`, `tests/artwork.test.cjs` |
| R6 | `tests/portal-corrections.test.cjs` | `tests/projects-admin-cache.test.cjs` |

Register entries: GL-119 to GL-124 in `docs/plans/technical-debt.md`.
