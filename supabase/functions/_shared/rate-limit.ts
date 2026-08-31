// rate-limit.ts — a bound on how often one staff account can spend money.
//
// WHY THIS EXISTS
// ---------------
// ai-proxy, mailgun-send, send-sms and dropbox-sign each call a paid vendor.
// All four require a staff session, so CLAUDE.md rule 7 — anything a stranger
// can trigger needs a rate limit — is already satisfied: a stranger cannot
// reach them at all.
//
// This is for the caller who is not a stranger. A stolen or borrowed staff
// session can loop any of these, and the bill lands on Mike: Anthropic tokens,
// Mailgun sends, Twilio messages, Dropbox Sign envelopes. Authorization decides
// WHO may call and says nothing about how often, and these are the four places
// where "how often" has an invoice attached.
//
// The decision about what happens when the counter itself is unreachable lives
// in rate-limit-policy.mjs, in plain JavaScript, so the test can exercise the
// shipped module rather than a transliteration of it.

import { degradedVerdict } from './rate-limit-policy.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/** What to do when the counter cannot be reached. */
export type OutagePolicy = 'allowance' | 'closed';

export interface RateLimitResult {
  allowed: boolean;
  /** Present only when the check could not run. */
  degraded?: string;
  /** True when the refusal came from the outage policy, not the counter. */
  outage?: boolean;
}

export interface RateLimitOptions {
  /**
   * Behaviour when `gl_rate_limit_hit` is unreachable. Defaults to 'closed':
   * a caller who forgets to choose gets the safe one, because the expensive
   * mistake here is spending money you cannot count.
   */
  onOutage?: OutagePolicy;
  /** Calls permitted per isolate per window while degraded. Default 5. */
  outageAllowance?: number;
  /** Length of the allowance window in seconds. Default 300. */
  outageWindowSeconds?: number;
}

/**
 * Count one call against `bucket` and say whether it is within budget.
 *
 * @param bucket        Stable key, e.g. `ai-proxy:<user id>`. Include the user
 *                      so one account cannot exhaust everyone else's budget.
 * @param limit         Calls permitted per window.
 * @param windowSeconds Window length.
 * @param opts          Outage behaviour. See rate-limit-policy.mjs.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return degradedVerdict(bucket, 'supabase env not configured', opts);
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gl_rate_limit_hit`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });
    if (!r.ok) return degradedVerdict(bucket, `rate limit rpc ${r.status}`, opts);
    // The function returns a bare boolean: true = allowed.
    const allowed = await r.json();
    return { allowed: allowed !== false };
  } catch (e) {
    return degradedVerdict(bucket, String(e).slice(0, 120), opts);
  }
}

/** Convenience: the 429 body these endpoints should return. */
export function rateLimitMessage(what: string): string {
  return `Too many ${what} requests in a short time. Wait a minute and try again.`;
}

/**
 * The 503 body for a refusal caused by the counter being down rather than by
 * the caller being over budget. Saying so matters: "try again in a minute" is
 * advice for the first case and misleading for the second, where the person to
 * tell is whoever can look at the database.
 */
export function rateLimitOutageMessage(what: string): string {
  return `${what} is paused: the usage counter is unavailable, so spending cannot be metered right now. This is a service fault, not a limit you hit.`;
}
