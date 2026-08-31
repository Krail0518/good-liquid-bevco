// rate-limit-policy.mjs — what to do when the usage counter cannot be reached.
//
// Plain JavaScript on purpose, following email-text.mjs and oauth-errors.mjs:
// Deno imports it directly, and tests/rate-limit-outage.test.cjs imports THIS
// module rather than a transliteration of the TypeScript one. That matters more
// than it looks. The first version of that test stripped types from
// rate-limit.ts with regexes, and the stripper quietly rewrote
// `{ degraded: why }` into `{ degraded }` — it parsed, so the "does it parse"
// guard passed, and the assertions were then running against a module subtly
// unlike the shipped one. A test that exercises a copy proves things about the
// copy.
//
// THE DECISION THIS FILE ENCODES
// -----------------------------
// The limiter used to fail open, unconditionally and without limit: if the
// counter was unreachable, every call proceeded. The reasoning was that a
// limiter which takes email and AI down when a table blips does more damage
// than the abuse it prevents.
//
// That is half right, and the external auditor was right to reject it.
// "Fails open" and "unbounded" are separate decisions and the first does not
// require the second. An outage is exactly when someone with a stolen session
// would prefer to be running, and "the table is unavailable" is a state an
// attacker can sometimes cause.
//
// So the behaviour is chosen per endpoint, by what one call costs against what
// being down costs:
//
//   'allowance'  mailgun-send, send-sms — a fraction of a cent per call, and
//                being down means a customer does not get their invoice.
//                Keep working, but only for a bounded number of calls.
//
//   'closed'     ai-proxy, dropbox-sign — dollars per call, and nothing breaks
//                operationally if they pause. There is no argument for spending
//                unmetered money while the meter is broken.

/* Per-isolate emergency allowance.
   Deno reuses an isolate across requests for a while but gives no guarantee, so
   this is a ceiling on one warm instance rather than a cluster-wide budget — a
   backstop, not a second limiter. Deliberately small for that reason: several
   isolates each spending their allowance must still add up to an amount worth
   shrugging at. */
const allowanceUsed = new Map();

/** Reset the per-isolate counters. Tests only; never called in production. */
export function _resetAllowance() {
  allowanceUsed.clear();
}

/**
 * Spend one unit of the emergency allowance for `key`.
 * Returns true if there was budget left.
 *
 * `key` is the ENDPOINT, not the full bucket. Buckets carry the user id, so
 * keying this per bucket would give every user their own emergency allowance —
 * and an attacker who can pick user ids would mint a fresh one per request,
 * which is not a bound at all.
 */
export function spendAllowance(key, limit, windowSeconds, now = Date.now()) {
  const cur = allowanceUsed.get(key);
  if (!cur || now >= cur.resetAt) {
    allowanceUsed.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count++;
  return true;
}

/**
 * Decide what happens when the counter could not be consulted.
 *
 * @param bucket        The full bucket key, e.g. `mailgun-send:<user id>`.
 * @param why           Why the check could not run, for the log.
 * @param opts          { onOutage, outageAllowance, outageWindowSeconds }
 * @returns             { allowed, degraded, outage? }
 */
export function degradedVerdict(bucket, why, opts = {}) {
  // Default to fail-closed: an endpoint whose author forgets to choose must get
  // the safe one, because the expensive mistake here is spending money you
  // cannot count.
  const policy = opts.onOutage || 'closed';
  if (policy === 'closed') {
    return { allowed: false, degraded: why, outage: true };
  }
  const endpoint = String(bucket).split(':')[0] || String(bucket);
  const ok = spendAllowance(
    endpoint,
    opts.outageAllowance == null ? 5 : opts.outageAllowance,
    opts.outageWindowSeconds == null ? 300 : opts.outageWindowSeconds,
  );
  return ok
    ? { allowed: true, degraded: why }
    : { allowed: false, degraded: why + ' (emergency allowance exhausted)', outage: true };
}
