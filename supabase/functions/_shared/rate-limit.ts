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
// FAILING OPEN IS DELIBERATE
// --------------------------
// If the counter itself is unreachable the call proceeds. A limiter that takes
// the CRM's email and AI down when a table is briefly unavailable would cause
// more damage than the abuse it prevents, and the abuse case needs a
// compromised account first. The failure is logged so it is visible rather than
// silent.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export interface RateLimitResult {
  allowed: boolean;
  /** Present only when the check could not run — the call was let through. */
  degraded?: string;
}

/**
 * Count one call against `bucket` and say whether it is within budget.
 *
 * @param bucket        Stable key, e.g. `ai-proxy:<user id>`. Include the user
 *                      so one account cannot exhaust everyone else's budget.
 * @param limit         Calls permitted per window.
 * @param windowSeconds Window length.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { allowed: true, degraded: 'supabase env not configured' };
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
    if (!r.ok) {
      return { allowed: true, degraded: `rate limit rpc ${r.status}` };
    }
    // The function returns a bare boolean: true = allowed.
    const allowed = await r.json();
    return { allowed: allowed !== false };
  } catch (e) {
    return { allowed: true, degraded: String(e).slice(0, 120) };
  }
}

/** Convenience: the 429 body these endpoints should return. */
export function rateLimitMessage(what: string): string {
  return `Too many ${what} requests in a short time. Wait a minute and try again.`;
}
