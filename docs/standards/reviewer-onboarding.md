# Reviewer Onboarding — ChatGPT / Codex

Per standard §7, ChatGPT/Codex is the independent reviewer and must not
rubber-stamp Claude's work. This document is the reviewer's entry point: what
access is needed, what to read first, what already exists to review, and the
permanent loop both agents operate in.

Written 2026-08-28, in response to the reviewer's own onboarding requirements.

---

## 1. Repository access

**Repository:** `Krail0518/good-liquid-bevco` (GitHub)

The reviewer needs read access to the repository, its branches, and its pull
requests. Connect GitHub to ChatGPT/Codex, or grant access another way — but
the review must run against the **actual repository**, not against pasted
excerpts.

That is not a formality. This project already produced one concrete failure of
the pasted-excerpt approach: an audit was run against a desktop folder assumed
to be the working copy. It was **209 commits stale** and held 149 files against
the repository's 296. Every conclusion drawn from it had to be discarded, and
one finding — "there is no automated test infrastructure" — was flatly wrong;
the repository has 16 test files and a CI workflow.

**Fetch before reviewing.** A cached remote ref reported that gap as 13 commits.

---

## 2. Rules both agents work against

In precedence order. Where they conflict, the earlier wins.

| Source | What it governs |
|---|---|
| `CLAUDE.md` | The operational hard rules. Each exists because breaking it caused a real production security hole. This wins any conflict. |
| `docs/standards/Good_Liquid_Bev_Co_CRM_AI_Engineering_Standard_v2.docx` | The v2 standard: 17 sections plus the automation addendum (Setup Instructions #1 and #2). |
| `docs/standards/*.md` | engineering, security, database, modular architecture, AI review policy |
| `AGENTS.md` | Division of labour between the two agents |
| `docs/plans/technical-debt.md` | The §12 register — current findings, severities, status |

`CLAUDE.md` is the one to read first. It documents the 2026-05-18 incident in
which a migration granted every authenticated user full access to every table,
justified by an assumption that expired silently when the customer portal
shipped the same day. Its lesson — *a security decision is only as good as the
assumption under it* — is the review posture this project needs.

### Severity and blocking

`BLOCKER / HIGH / MEDIUM / LOW / INFORMATIONAL`. BLOCKER and HIGH block release
unless the owner explicitly accepts the risk (§8 step 7).

---

## 3. State of the audit

**The audit is complete. No reorganization has been performed.**

The reviewer's instruction — *finish the audit first, don't reorganize
everything yet* — matches what was done, and the reasoning is worth confirming
independently:

`src/modules/{customers,invoicing,pipeline,production,quotes,inventory}` exist
as **empty README placeholders**. The 54 `crm-*.js` files remain at the
repository root. They were deliberately not moved, because `index.html`
hardcodes ~37 order-dependent root-absolute script tags and Vercel serves from
the repository root — a bulk move takes the site down. This is recorded as
GL-037, and it is also what the scaffold's own README asks for:

> Do not replace or move working production code just to match this folder tree.

Module extraction should happen one capability at a time, behind its own PR.

### How the audit was produced

Fourteen agents across seven dimensions — tenant isolation, silent writes,
browser storage, injection, edge functions, test coverage, release automation —
with every finding then handed to a **separate agent instructed to refute it**.
Four findings were killed outright and five had their severity corrected. Only
survivors were recorded, at post-verification severity.

The reviewer should treat that as a first pass, not a cleared bill. Two things
to weigh:

- **The refutations are as reviewable as the findings.** One in particular is
  worth checking: `saveInvoice` in `index.html` was refuted as unreachable dead
  code because `cNav` runs nav guards first and `crm-permissions.js`
  intercepts the `newinv` page. That reasoning was independently confirmed
  before the finding was dropped, but it is exactly the kind of call worth a
  second opinion.
- **Roughly one in three of Claude's fixes had a defect caught during
  verification** — an incomplete guard, two test-harness bugs. That rate is the
  argument for this review loop existing.

---

## 4. What is ready to review

### Merged

| PR | Contents |
|---|---|
| [#294](https://github.com/Krail0518/good-liquid-bevco/pull/294) | Two migrations, **already applied to production** — signup privilege escalation, and `compliance-photos` storage policies |

### Open

| PR | Contents | Notes |
|---|---|---|
| [#295](https://github.com/Krail0518/good-liquid-bevco/pull/295) | `app_settings` migration destroyed the only copy of ten settings | 20 checks; 12 fail pre-fix |
| [#296](https://github.com/Krail0518/good-liquid-bevco/pull/296) | Stored XSS from the public tour-booking form into a staff screen | Edge function needs a separate deploy |
| [#297](https://github.com/Krail0518/good-liquid-bevco/pull/297) | Scaffold, standards, and the 30-item debt register | This document lives here |
| [#298](https://github.com/Krail0518/good-liquid-bevco/pull/298) | `apply-sql.yml` could run unmerged SQL against production | Needs `production-db` reviewers configured |
| [#299](https://github.com/Krail0518/good-liquid-bevco/pull/299) | `security-invariants.sh` only ever tested the `anon` role | |
| [#300](https://github.com/Krail0518/good-liquid-bevco/pull/300) | Role change and deactivation never reached the database | |
| [#301](https://github.com/Krail0518/good-liquid-bevco/pull/301) | Mark-paid reported success on rejected writes | |
| [#302](https://github.com/Krail0518/good-liquid-bevco/pull/302) | Deletes wrote a false audit entry | Stacked on #301 |
| [#303](https://github.com/Krail0518/good-liquid-bevco/pull/303) | A refused INSERT created a tab-only record | Stacked on #302 |

**Stacked PRs do not run CI.** `smoke-test.yml` triggers on
`pull_request: branches: [main]`, so #302 and #303 target another branch and
their jobs never fire. They were verified locally instead. Merge in order —
301 → 302 → 303 — and each retargets to `main` and runs.

### The most useful independent checks

1. **Confirm #294 actually closed the hole.** It is applied to production
   already. `handle_new_user()` should gate on `auth.users.invited_at`.
2. **Re-derive the severity on the storage finding.** It was reported as live
   exposure, then downgraded to MEDIUM after `storage.buckets` turned out not
   to contain `compliance-photos` at all. Confirm the bucket's absence.
3. **Check the unchecked-write cluster is actually complete.** #300–#303 cover
   role/status, mark-paid, deletes and inserts. `crm-*.js` modules have their
   own writes that were catalogued but not yet fixed — see the register.

---

## 5. The permanent workflow

```
Claude builds  →  GitHub PR  →  ChatGPT/Codex reviews
                                        ↓
     owner approves  ←  re-review  ←  Claude remediates
                ↓
            merge / deploy
```

Per §8 and Setup Instruction #2:

1. Claude implements on a feature branch, runs the tests, opens a PR with a
   change summary and test evidence.
2. ChatGPT/Codex reviews the diff **and the surrounding architecture** —
   regression risk, module boundaries, persistence, RLS, authz, validation,
   error handling, performance, test coverage.
3. Findings carry: **id, severity, affected files, explanation, recommended
   remediation, release-blocking status**.
4. BLOCKER and HIGH must be fixed or explicitly accepted by the owner before
   approval.
5. Claude fixes the underlying defect on the same branch — **never by
   suppressing, deleting, or rewriting the finding to make the review pass** —
   and adds a test that demonstrates the correction.
6. Re-review marks every original finding `RESOLVED`, `STILL PRESENT`, or
   `ACCEPTED BY OWNER`, and looks for regressions introduced by the fix.
7. The loop repeats until no release-blocking finding remains.
8. **The owner approves. Human release authority is not delegated to either
   agent** (§17).

### Conventions in use

- Every fix ships with a test that **fails against the pre-fix code**. PR
  descriptions state both numbers. A test that passes before and after proves
  nothing.
- Where a fix cannot be verified, the PR says so explicitly rather than
  implying coverage.
- Migrations are applied via `apply_migration` and the file is committed, with
  the local filename matching the recorded ledger version so `db push` does not
  re-run it. Every migration carries a `ROLLBACK:` note.

---

## 6. Known gaps in the automation

The addendum's pipeline does not exist yet. Recorded as GL-030 through GL-036:

- `weekly-ai-review.yml` is an echo-only placeholder — no review gate exists in
  executable form
- `ci.yml` and `security-scan.yml` are unconditionally-green jobs running under
  trustworthy names
- nothing blocks deployment on a failed gate; Vercel auto-deploys on push to
  `main`
- there is no predictable location where review findings are written, so the
  loop above currently depends on humans moving information between agents
- the AI-review issue template lacks the release-blocking field and the
  `STILL PRESENT` re-review state
- the Tuesday 08:00 cron drifts an hour every winter — `0 12 * * 2` is EDT-only

Until GL-030 and GL-031 land, **the review gate is a convention, not a
control.** Nothing prevents a change from reaching production unreviewed.
