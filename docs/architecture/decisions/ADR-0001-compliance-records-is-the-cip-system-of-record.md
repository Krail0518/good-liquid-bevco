# ADR-0001 — `compliance_records` is the system of record for CIP / sanitation

**Status:** Accepted
**Date:** 2026-08-28

## Context

Two tables in `public` could plausibly hold CIP (clean-in-place) sanitation
cycles, and it was not written down anywhere which one does.

`cip_logs` was created in `20260516_new_feature_tables.sql` with its own RLS
policy, an index on `cycle_at`, an `updated_at` trigger, and later columns
added in `20260518_schema_gap_pack.sql`. It looks like a maintained table.

`compliance_records` holds the generic GMP register. CIP cycles are filed
through it under `form_code = 'GMP-SAN-002'`, the canonical 9-step FDA form.

Measured in production on 2026-08-28:

| Table | Rows |
|---|---|
| `cip_logs` | 0 |
| `compliance_records` (all) | 82 |
| `compliance_records` where `form_code = 'GMP-SAN-002'` | 72 |

No client code writes `cip_logs`. Two places read it, and neither uses the
result:

- `auditor.html` fetched `cip_logs?limit=1&select=id` into a variable that was
  never referenced again — a wasted round trip on every external auditor page
  load, alongside two identical dead probes of `defects` and `hold_tags`.
- `crm-cip-audit.js` named it in a `console.warn` that pointed anyone
  debugging a missing sanitation record at the wrong table. That warning also
  could not fire; see the consequences below.

The ambiguity had already cost debugging time, which is why it was raised as
GL-027.

## Decision

**`compliance_records` is the system of record for CIP cycles**, filed under
`form_code = 'GMP-SAN-002'`. It holds all 72 real records, it is what the
module reads and what the compliance form writes.

**`cip_logs` is deprecated.** Its dead readers are removed. The table itself
is left in place for now and is dropped separately, because dropping it
changes the authorization surface and must move through the drift baseline
procedure in `docs/runbooks/deployment.md` rather than riding along with an
application fix.

## Alternatives considered

**Migrate onto `cip_logs` and treat it as the real CIP table.** Rejected. It
would mean moving 72 FDA-relevant records for no functional gain, and CIP
would then be the one register outside the generic GMP mechanism that already
gives it PCQI sign-off, deviation handling, hold-tag spawning and the auditor
export.

**Keep both, with `cip_logs` as a denormalised reporting copy.** Rejected. It
was never populated, so there is nothing to preserve, and a second copy of an
FDA record invites the two to disagree.

**Drop `cip_logs` in this same change.** Rejected on process, not on merit —
see the decision above. It is empty, so there is no urgency.

## Consequences

The dead-table confusion is gone, and removing the three unused `auditor.html`
probes takes three round trips off every external auditor page load.

Chasing this down also exposed a real defect behind the misleading warning,
fixed in the same change (GL-026). `crm-cip-audit.js` had a `loadLocal()`
reading `gl_cip_logs` and a `saveLocal()` writing it. `saveLocal()` was never
called, so nothing had ever written that key and `loadLocal()` could only
return `[]`. The fallback that was supposed to surface unsaved work was
therefore unreachable, and so was the warning attached to it.

Meanwhile `dbInsert()` in `crm-compliance.js` does keep a rejected record —
under `gl_cache_compliance_records`, a different key. So a CIP cycle whose
save was rejected was preserved on disk but invisible on the CIP page, which
rendered "No cycles logged yet". An operator could not distinguish an
FDA-required sanitation record that failed to file from a cycle nobody had
logged.

The module now reads the key that is actually written, shows unsaved cycles
with a `NOT SAVED` marker and a banner naming the failure, and offers a retry
that re-sends the original payload and checks the returned row count — a write
that RLS silently drops returns zero rows and no error.

The remaining risk is that someone reintroduces a `cip_logs` reference. The
guard against that is `tests/cip-system-of-record.test.cjs`, which fails if
client code references the deprecated table or if the CIP module reads a
localStorage key that nothing writes.
