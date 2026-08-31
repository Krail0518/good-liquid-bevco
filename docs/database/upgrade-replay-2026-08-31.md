# Upgrade replay — 31 August 2026

Auditor item D, and definition-of-done item 7: *"A clean migration replay and an
upgrade replay produce the same schema, policies, grants, and functions."*

## What was compared, and what that proves

| | how it got there |
|---|---|
| **production** `ufjkeqmxwuyhbqyugcgg` | years of incremental migrations, plus the three payment migrations of 31 August |
| **staging** `ehnumcmkbmzvwaawkdsv` | the entire migration history replayed from empty, then the same three payment migrations |

Comparing those two answers the question directly. If a database built from
nothing by the committed history, then advanced through the newest migrations,
lands where production is, then the history describes the system. Where they
differ, the history does not.

Fingerprints from `scripts/schema-fingerprint.sql`, run against both.

## Result

| category | production | clean replay + upgrade | verdict |
|---|---|---|---|
| tables | 91 · `b226a42d` | 91 · `b226a42d` | **identical** |
| RLS flags | 91 · `a1fe1f9c` | 91 · `a1fe1f9c` | **identical** |
| triggers (incl. bound function) | 61 · `2b2d9290` | 61 · `2b2d9290` | **identical** *(after the fix below)* |
| functions | 60 | 60 | same names, **6 differ in SECURITY DEFINER** |
| columns | 1049 | 1062 | production is missing **13** |
| constraints | 230 | 245 | production is missing 15 |
| indexes | 237 | 246 | production is missing 9 |
| policies | 585 | 377 | production has **208 more** |
| grants | 1916 | 665 | production has **1251 more** |

The three identical categories are not a small result: every table, every RLS
flag, and every trigger-to-function binding agree exactly. The differences are
all in one direction each, and each has a cause.

---

## 1. Six functions are SECURITY DEFINER in production and would not be in a rebuild

**The most serious finding here.**

| function | production | clean rebuild |
|---|---|---|
| `gl_send_quote_decks` | `SECURITY DEFINER` | `SECURITY INVOKER` |
| `trigger_estimate_deal_value` | `SECURITY DEFINER` | `SECURITY INVOKER` |
| `trigger_notify_new_deal` | `SECURITY DEFINER` | `SECURITY INVOKER` |
| `trigger_notify_new_quote` | `SECURITY DEFINER` | `SECURITY INVOKER` |
| `trigger_notify_onboarding` | `SECURITY DEFINER` | `SECURITY INVOKER` |
| `trigger_notify_tour_booked` | `SECURITY DEFINER` | `SECURITY INVOKER` |

`SECURITY DEFINER` is the difference between running as the caller and running
as the owner. `scripts/check-db-drift.sh` singles this exact function out in its
own header: *"gl_send_quote_decks was SECURITY DEFINER, EXECUTE-able by
authenticated, and read a Vault secret with no authz check."*

Two things follow, and they point in opposite directions:

- **Production is probably the correct state.** The five `trigger_notify_*`
  functions fire on insert and post to an Edge Function using a secret read from
  Vault. As `SECURITY INVOKER` they would run as whoever wrote the row — an
  anonymous form submitter for the tour and quote triggers — and could not read
  that secret. A rebuilt database would have notifications that silently stop
  working.
- **The repository is wrong either way.** Whatever the right answer is, the
  committed history does not produce it, so a restore from this repository
  produces six functions with different privilege semantics from the system it
  is supposed to reproduce.

**Not changed here.** Writing a migration to set six functions `SECURITY
DEFINER` is a privilege change, and it should be made deliberately by the owner
rather than folded into an audit response at the end of a long day. Logged as
**GL-066**.

## 2. Production is missing 13 columns the history creates

| table | production | history | missing |
|---|---|---|---|
| `contact_submissions` | 10 | 16 | 6 |
| `case_studies` | 14 | 15 | `updated_at` |
| `content_calendar` | 10 | 11 | `updated_at` |
| `defects` | 20 | 21 | `updated_at` |
| `resources` | 10 | 11 | `updated_at` |
| `trade_shows` | 13 | 14 | `updated_at` |
| `vendors` | 24 | 25 | `updated_at` |
| `yield_logs` | 11 | 12 | `updated_at` |

**Mechanism:** the migrations use `create table if not exists`. Those tables
already existed in production when the migration first ran — created by hand,
before the history was kept — so the statement did nothing and the columns it
would have created were never added. A no-op that looks like a success.

This is GL-055 in reverse. That finding was *production has ten tables the
repository never creates*; this one is *the repository creates columns
production has never had*. The same root cause produces both: for a long period,
the database and the migration folder were maintained independently.

`contact_submissions` is in live use (10 rows). The six columns it lacks —
`brand_name`, `city`, `funding_stage`, `lead_source`, `product_type`,
`timeline`, `volume`, `state` — are lead-qualification fields. No application
code writes them, so nothing is currently losing data; but a future feature
written against the repository schema would fail against production. Logged as
**GL-065**.

The 15 constraint and 9 index differences follow the same 13 columns.

## 3. Production has 208 more policies and 1251 more grants

Expected, and consistent with the register. These are the legacy `USING (true)`
policies and the grants applied by hand in the Supabase dashboard — the 2026-05-18
incident described at the top of `CLAUDE.md`, which appears in no migration by
definition. `scripts/check-rls-coverage.sh` now proves the permissive ones are
constrained; this comparison says how many of them the history does not create.

**Consequence, stated plainly:** a restore from this repository would produce a
database that is *more* locked down than production, not less. That is the safe
direction, but it means a restore is not a faithful reproduction and would need
the grants re-applied for the application to work.

## 4. One divergence found and fixed

`trg_quotes_updated_at` was bound to `set_updated_at()` in production and to a
bespoke `set_quotes_updated_at()` in a clean replay. Both function bodies are
`new.updated_at = now()`, so behaviour was identical and nothing was broken.

Cause: `20260713000000_quotes_table.sql` creates the bespoke function; GL-049
later attaches the shared one to twenty-one tables but *skips* any table that
already has a trigger of the name it would use. On a clean replay the bespoke
trigger exists by then, so quotes was skipped.

`20260831210000_converge_quotes_updated_at.sql` rebinds the trigger to the
shared function and drops the bespoke one. It is a no-op against production and
brings a rebuild to the same place. After it, the trigger fingerprints match
exactly on both databases.

This is also the finding that improved the tool: the first fingerprint hashed
only *(table, trigger name)* and reported triggers as identical while the two
databases had the same trigger bound to different functions. The query now
includes the bound function, and the function category includes `prosecdef` —
which is how §1 was found at all.

## Honest limits

- Staging is schema-only. Row counts and checksums were **not** compared,
  because staging holds no production data and copying it there to compare would
  create a second copy of every client's records outside production. The
  auditor's request for "representative row counts/checksums" is therefore **not
  met**, and this is a deliberate refusal rather than an oversight.
- Storage policies were not compared: the fingerprint covers `public`, and
  `storage.objects` policies live in another schema. Named here rather than
  quietly omitted.
- The comparison ran once, by hand. It is not yet a CI gate. Making it one
  requires a disposable database per run, which is the next step and is not done.
