---
name: AI Review Finding
about: Track an AI code/security/architecture finding through remediation and re-review
title: "[AI REVIEW] "
labels: ai-review
---

<!--
Setup Instruction #2 requires every finding to carry six fields: id, severity,
affected files, explanation, recommended remediation, and RELEASE-BLOCKING
STATUS. The last one was missing from this template, so the remediation loop
had no field to gate a merge on.

The re-review section was also missing STILL PRESENT — without it a re-review
could only record success, which is the same defect the audit kept finding in
the code: a check that cannot express failure.
-->

## Finding ID

<!-- e.g. GL-041. Stable: remediation and re-review both refer to it. -->

## Severity

<!-- One of: -->
- [ ] BLOCKER — data loss, security hole, or breaks production
- [ ] HIGH — release-blocking defect or standard violation with real impact
- [ ] MEDIUM — technical debt, real but not urgent
- [ ] LOW — hygiene
- [ ] INFORMATIONAL — no action required

## Release-blocking

<!-- Per §8 step 7, BLOCKER and HIGH block release unless the owner explicitly
     accepts the risk. State it here rather than leaving it inferred. -->
- [ ] **Blocks release** — must be fixed or explicitly accepted before merge
- [ ] Does not block release

## Module / affected files

<!-- file:line where possible. A finding without a location cannot be verified
     or refuted. -->

## Explanation

<!-- What is wrong, and the evidence. Quote the offending code. -->

## Failure scenario

<!-- Concrete: what input or state produces what wrong outcome. "Could be
     unsafe" is not a finding; "an RLS rejection returns 0 rows and the UI
     reports success" is. -->

## Recommended remediation

<!-- What to change. If the fix is not obvious, say what you would check first. -->

---

## Remediation (filled in by Claude)

**Commit SHA:**

**What changed:**

**Test that fails against the pre-fix code:**
<!-- A test that passes both before and after proves nothing. State both
     numbers, e.g. "18 pass on the branch, 6 fail against origin/main". -->

**Not verified:**
<!-- Anything that could not be exercised, and why. Say so explicitly rather
     than implying coverage. -->

Per Setup Instruction #2, a finding must be **fixed or explicitly accepted**.
Suppressing, deleting, or rewriting it to make the review pass is not
remediation.

---

## Re-review verdict

<!-- Every original finding gets exactly one of these. -->
- [ ] **RESOLVED** — verified fixed
- [ ] **STILL PRESENT** — the fix did not address it, or addressed it partially
- [ ] **ACCEPTED BY OWNER** — risk accepted; record who and why below

**Regressions introduced by the remediation:**
<!-- Setup Instruction #2 asks the re-review to look for these specifically. -->

**Owner acceptance (if applicable):**
<!-- Who accepted, when, and the reasoning. Human release authority is not
     delegated to either agent (§17). -->
