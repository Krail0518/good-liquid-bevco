# Pull Request

## Business objective

<!-- What this is for, and the acceptance criteria. -->

## Owning module

## Scope

## Cross-module dependencies

<!-- §3: a change to one module should require minimal or zero modification to
     unrelated ones. If this PR touches several, say why. -->

## Database changes

<!-- Migration file, and its ROLLBACK note. If it was applied to production
     before merge, say so and give the version — the repo must not silently
     fall behind the database. -->

## RLS / security impact

## Tests run

<!-- Name the test and both numbers: how many pass on this branch, and how many
     FAIL against the pre-fix code. A test that passes before and after proves
     nothing. If something could not be exercised, say so explicitly rather
     than leaving coverage implied. -->

## Regression risks

## Rollback plan

## AI review status

<!-- Findings raised, and for each: RESOLVED / STILL PRESENT / ACCEPTED BY
     OWNER. BLOCKER and HIGH block release unless the owner explicitly accepts
     the risk (§8 step 7). -->

---

## §15 checklist

<!-- The fifteen items the standard requires. Tick honestly: an unticked box
     with a note is more useful than a ticked one that was not checked. -->

- [ ] Business requirement and acceptance criteria are clear
- [ ] Correct module boundary identified
- [ ] No unnecessary cross-module coupling introduced
- [ ] Business data persists in Supabase — **not** browser storage
- [ ] No sensitive data stored in browser storage
- [ ] Database migration reviewed, with a rollback note
- [ ] RLS / authentication / authorization reviewed
- [ ] Input validation and error handling reviewed
- [ ] Secrets are not exposed
- [ ] Automated tests added or updated where appropriate
- [ ] Existing workflows and regressions considered
- [ ] Performance impact considered
- [ ] Dependencies reviewed
- [ ] Rollback path understood
- [ ] Technical debt created by this change is documented in `docs/plans/technical-debt.md`

## Writes touched by this PR

<!-- CLAUDE.md rule 4. RLS rejects silently — 0 rows, no error — so an
     unchecked write reports success while nothing saved. This pattern is
     responsible for ~40 past bugs in this repo, which is why it gets its own
     section rather than a checklist line. -->

- [ ] Every `.update()` / `.delete()` / `.insert()` added here appends `.select()`
- [ ] Both `error` **and** an empty returned array are treated as failure
- [ ] Local cache, UI state and audit entries are only written **after** the server confirms
- [ ] N/A — this PR adds no database writes

## Deploy steps beyond merging

<!-- Merging to main deploys the static site via Vercel and nothing else. -->

- [ ] Edge functions — needs `gh workflow run "Deploy Supabase"` (list which)
- [ ] Migration — applied via `apply_migration`, file committed, local filename matches the recorded ledger version
- [ ] Nothing — a Vercel deploy is sufficient
