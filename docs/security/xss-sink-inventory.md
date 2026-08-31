# XSS sink inventory — 31 August 2026

Auditor item B. Their instruction was specific and correct: *"Enumerate every
sink rather than counting escapers."*

The count they were reacting to was ours. An earlier response offered "1,418
escape call sites" as though the number were the argument. It is not: a large
number of escape calls is consistent with one unescaped sink, and it is the
unescaped one that matters.

## What was enumerated

Scanned with `tests/_jsscan.cjs`, the shared walker, so comments and string
literals are not mistaken for code. Across `src/**/*.js`, `crm-*.js` and the
root HTML:

| sink kind | count | what it is |
|---|---|---|
| `innerHTML =` / `+=` | 584 | the bulk of the CRM's rendering |
| `window.open(...)` | 24 | popups; the report/print windows |
| `document.write(...)` | 11 | writing into those popups |
| `insertAdjacentHTML` | 7 | incremental list rendering |
| `location.href/assign/replace` | 4 | navigation |
| `outerHTML =` | 4 | node replacement |
| **total** | **634** | across 71 files |

| dangerous kind | count |
|---|---|
| `eval(` | **0** |
| `new Function(` | **0** |
| `setTimeout`/`setInterval` with a string | **0** |
| `iframe.srcdoc` | **0** |
| `createContextualFragment` | **0** |

The five that execute strings as code, or render arbitrary HTML in a nested
browsing context, are all absent — and `tests/xss-sinks.test.cjs` fails if any
appears.

## What the enumeration found

**25 escaper definitions, in three different shapes.**

| character class | definitions | escapes `'` | escapes `&` |
|---|---|---|---|
| `[<>&"]` | 15 | **no** | yes |
| `[&<>"']` | 8 | yes | yes |
| chained `.replace()` × 4 | 2 | **no** (1 of 2) | yes |

Seventeen of twenty-five did not encode the apostrophe. In an attribute
delimited by single quotes, a raw apostrophe closes the attribute and everything
after it becomes new attributes — `onmouseover=` among them.

**Was it exploitable? No, and the distinction is the point.** Every file with a
weak escaper was searched for a single-quoted attribute built by concatenation:
there were **zero**. The gap was latent, not live.

It is closed anyway. All 25 escapers now encode `& < > " '`, and the test
exercises each one. "No caller happens to hit it today" is the same reasoning
that made the 2026-05-18 RLS incident possible, and this repository has already
paid for that argument once.

One escaper was missed by the automated fix because its callback parameter was
named `ch` rather than `c` — the pattern-matching trap again. **The test caught
it**, which is the system working: the fix was mechanical, the check was
behavioural, and the behavioural one won.

## How each sink is protected, by context

| context | encoding | verified by |
|---|---|---|
| element content | `<` `>` `&` encoded | payload `<img src=x onerror=alert(1)>` per escaper |
| double-quoted attribute | `"` encoded | payload `x" onmouseover="alert(1)` |
| single-quoted attribute | `'` encoded | payload `x' onmouseover='alert(1)` |
| entity smuggling | `&` encoded | payload `&lt;script&gt;` must become `&amp;lt;` |
| null / undefined | empty string, never `"null"` | direct |

Each escaper is **extracted from the shipped source and executed** — not
described, not copied. The test builds the function with `new Function` from the
exact bytes in the file, so it cannot drift from what runs.

## What this does NOT establish

Stated plainly, because the auditor's objection was to exactly this kind of
overclaim.

- **It does not prove all 584 `innerHTML` sinks are fed escaped data.** That
  needs source-to-sink data-flow analysis, which this repository does not have
  and which no check here performs. What is proved: the escapers are sound in
  every context, the dangerous sink kinds are absent, and the sink count cannot
  grow without someone deciding to raise a budget.
- **CSS context is not covered.** No sink interpolates untrusted data into a
  `style` attribute or a `<style>` block today; if one appears, HTML escaping is
  not sufficient for it and this inventory would need extending.
- **URL context is only partly covered.** `javascript:` URLs were removed
  wholesale in the GL-DEF-01 work and CSP now blocks inline script, but no check
  here validates the *scheme* of a URL built from user data.
- **Email and PDF output** are separate rendering boundaries with their own
  escapers (`src/services/email.js`, the invoice PDF popup). Both are included
  in the escaper tests above; neither has been fuzzed end to end.

## Reproducing it

```bash
node tests/xss-sinks.test.cjs
```

Runs in CI on every push. The sink budget is 606 (the count on 31 August 2026,
by the test's own line-based measure); raising it is a deliberate act in the
pull request that adds a sink.
