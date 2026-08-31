// rate-limit-policy.mjs — what to do when the usage counter cannot be reached.
//
// Plain JavaScript on purpose, following email-text.mjs and oauth-errors.mjs:
// Deno imports it directly, and tests/rate-limit-outage.test.cjs imports THIS
// module rather than a transliteration of the TypeScript one.
//
// THE ANSWER IS: FAIL CLOSED. ALL FOUR ENDPOINTS.
//
// This is the third answer to the same question, and the reasoning matters more
// than the rule.
//
//   First answer — fail open, unconditionally. Wrong: an outage is exactly when
//   someone with a stolen session would prefer to be running, and "the table is
//   unavailable" is a state an attacker can sometimes cause.
//
//   Second answer — fail closed for the expensive endpoints, and a bounded
//   emergency allowance for mailgun-send and send-sms so customers still get
//   their invoices during a blip. The auditor rejected this too, and was right:
//   the allowance lived in a Map inside one Deno isolate. Concurrent and
//   cold-started isolates each get their own, so "20 per 5 minutes" was never a
//   cluster-wide ceiling. It was a local backstop being described as a global
//   bound, which is worse than no bound at all — it reads like a limit in the
//   code and in the documentation, and is not one.
//
//   Third answer — fail closed everywhere, which is also what the operational
//   argument actually supports once you look at it properly. gl_rate_limit_hit
//   lives in the same Postgres as invoices, clients and templates. If it cannot
//   be reached, the CRM cannot read the invoice it wants to email either. The
//   allowance was protecting the ability to send mail in a situation where
//   there is nothing to send. It bought nothing and cost a real bound.
//
// A durable cluster-wide allowance would need shared state that survives the
// database being down — a second store, with its own availability and its own
// failure modes, to protect a code path that is useless while the first store
// is down. That is not worth building. If a genuine emergency allowance is ever
// wanted, the place for it is a provider-side hard budget (Anthropic, Twilio,
// Mailgun, Dropbox Sign), which is enforced by someone else's infrastructure
// and cannot be defeated by ours being unavailable.

/**
 * Decide what happens when the counter could not be consulted.
 *
 * Always refuses. The signature keeps `opts` so call sites remain explicit
 * about having considered the question, and so a future durable design has
 * somewhere to land — but there is no option that permits the call.
 *
 * @param bucket  The full bucket key, e.g. `mailgun-send:<user id>`.
 * @param why     Why the check could not run, for the log.
 * @returns       { allowed: false, degraded, outage: true }
 */
export function degradedVerdict(bucket, why, opts = {}) {
  return { allowed: false, degraded: why, outage: true };
}

/**
 * True when a policy value would have permitted spending during an outage.
 * Exported so the test can assert that no call site declares one, rather than
 * relying on a comment to keep them honest.
 */
export function permitsSpendingWhileDegraded(policy) {
  return policy === 'allowance';
}
