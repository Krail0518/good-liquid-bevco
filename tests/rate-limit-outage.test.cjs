#!/usr/bin/env node
/* What the paid-vendor limiter does when the counter itself is unreachable.
 *
 * WHY THIS EXISTS
 * ---------------
 * The limiter used to fail open, unconditionally and without limit: if
 * `gl_rate_limit_hit` could not be reached, every call proceeded. The external
 * auditor rejected that, correctly. "Fails open" and "unbounded" are separate
 * decisions and the first does not require the second — an outage is exactly
 * when someone with a stolen session would prefer to be running, and "the
 * table is unavailable" is a state they can sometimes cause.
 *
 * The behaviour is now chosen per endpoint by unit cost against operational
 * cost, and this file holds that choice in place. Two properties matter and
 * neither is visible by reading one file:
 *
 *   1. The DEFAULT is fail-closed. A future endpoint whose author forgets to
 *      choose must get the safe one.
 *   2. The allowance is BOUNDED. It is easy to write an allowance that resets
 *      on every call and therefore bounds nothing.
 *
 * HOW IT TESTS THE REAL MODULE
 * ----------------------------
 * The decision lives in `_shared/rate-limit-policy.mjs`, plain JavaScript that
 * Deno and Node both load, so this imports the SHIPPED module. The first
 * version of this file instead stripped types out of rate-limit.ts with
 * regexes. That stripper rewrote `{ degraded: why }` into `{ degraded }` — it
 * still parsed, so the "does it parse" guard passed, and every assertion after
 * it was quietly running against a module unlike the deployed one. Requiring
 * the .ts directly is not an option either: Node 20 on the CI runner cannot
 * strip types, so it would pass here and fail there.
 *
 * Run:  node tests/rate-limit-outage.test.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');
const POLICY = path.join(SHARED, 'rate-limit-policy.mjs');
const TS = path.join(SHARED, 'rate-limit.ts');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + String(detail).split('\n').join('\n        '));
}

(async () => {
  console.log('\nPaid-vendor limiter — behaviour when the counter is down\n');

  const raw = fs.readFileSync(TS, 'utf8');

  // ── the TypeScript wrapper delegates rather than duplicating ──────────────
  check('rate-limit.ts imports the policy module',
    /from '\.\/rate-limit-policy\.mjs'/.test(raw),
    'if the decision is reimplemented in the .ts, this file stops testing the ' +
    'code that actually runs');
  check('every degraded path goes through degradedVerdict',
    (raw.match(/degradedVerdict\(/g) || []).length >= 3 &&
    !/allowed:\s*true,\s*degraded:/.test(raw),
    'a hand-rolled `{allowed:true, degraded:…}` anywhere in the wrapper is an ' +
    'unbounded fail-open that bypasses the policy');
  check('a separate message exists for an outage refusal',
    /export function rateLimitOutageMessage/.test(raw),
    '"try again in a minute" is advice for a caller who hit a limit. Someone ' +
    'refused because the counter is down did not hit a limit.');

  // ── the policy itself, executed ───────────────────────────────────────────
  const policy = await import('file:///' + POLICY.split(path.sep).join('/'));
  const { degradedVerdict, _resetAllowance } = policy;

  _resetAllowance();
  let r = degradedVerdict('ai-proxy:u1', 'connection refused', { onOutage: 'closed' });
  check('policy closed -> refused, and flagged as an outage',
    r.allowed === false && r.outage === true && r.degraded === 'connection refused',
    JSON.stringify(r));

  r = degradedVerdict('some-new-endpoint:u1', 'connection refused');
  check('no policy given -> fail-closed by default',
    r.allowed === false && r.outage === true, JSON.stringify(r) +
    '  the expensive mistake is spending money you cannot count');

  // Allowance endpoints: bounded, and the bound actually bites.
  _resetAllowance();
  const opts = { onOutage: 'allowance', outageAllowance: 3, outageWindowSeconds: 300 };
  const verdicts = [];
  for (let i = 0; i < 6; i++) {
    verdicts.push(degradedVerdict('mailgun-send:u1', 'rpc 500', opts).allowed);
  }
  check('an allowance endpoint keeps working while degraded',
    verdicts.slice(0, 3).every((v) => v === true), JSON.stringify(verdicts));
  check('the allowance is BOUNDED — call 4 onward is refused',
    verdicts.slice(3).every((v) => v === false), JSON.stringify(verdicts) +
    '  an allowance that never runs out is the unbounded fail-open this ' +
    'change exists to remove');

  r = degradedVerdict('mailgun-send:u1', 'rpc 500', opts);
  check('an exhausted allowance is reported as an outage, not a rate limit',
    r.allowed === false && r.outage === true && /allowance exhausted/.test(r.degraded || ''),
    JSON.stringify(r));

  // Keyed per endpoint, not per bucket: buckets carry the user id, so an
  // attacker who can pick user ids would mint a fresh allowance per request.
  r = degradedVerdict('mailgun-send:u2', 'rpc 500', opts);
  check('the allowance is shared across users of one endpoint',
    r.allowed === false, JSON.stringify(r) +
    '  keyed per user, every user id would mint a fresh allowance and the ' +
    'bound would mean nothing');

  r = degradedVerdict('send-sms:u1', 'rpc 500', opts);
  check('a different endpoint has its own allowance', r.allowed === true, JSON.stringify(r));

  // The window has to expire, or the allowance is a one-time budget for the
  // life of the isolate rather than a rate.
  _resetAllowance();
  const now = 1_000_000;
  policy.spendAllowance('x', 1, 60, now);
  check('the allowance refuses a second call inside the window',
    policy.spendAllowance('x', 1, 60, now + 1000) === false);
  check('the allowance resets once the window has passed',
    policy.spendAllowance('x', 1, 60, now + 61_000) === true,
    'without a reset this is a lifetime budget, not a rate');

  // ── the four call sites carry a deliberate policy ─────────────────────────
  console.log('');
  const EXPECTED = {
    'ai-proxy': 'closed',
    'dropbox-sign': 'closed',
    'mailgun-send': 'allowance',
    'send-sms': 'allowance',
  };
  for (const [fn, want] of Object.entries(EXPECTED)) {
    const s = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', fn, 'index.ts'), 'utf8');
    check(fn + ' declares onOutage: ' + want,
      new RegExp("onOutage:\\s*'" + want + "'").test(s),
      'the choice must be explicit at the call site, where the cost of a ' +
      'single call is the thing being reasoned about');
    check(fn + ' answers an outage refusal with 503, not 429',
      /rateLimitOutageMessage\([^)]*\),\s*503/.test(s),
      'a 429 tells the caller they hit a limit; they did not');
  }

  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})();
