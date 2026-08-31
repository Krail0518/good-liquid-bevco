#!/usr/bin/env node
/* What the paid-vendor limiter does when the counter itself is unreachable.
 *
 * THE RULE: all four endpoints fail closed. There is no allowance.
 *
 * This has been answered three times and the history is the point.
 *
 *   1. Fail open, unconditionally. The external auditor rejected it: an outage
 *      is exactly when someone with a stolen session would prefer to be
 *      running, and "the table is unavailable" is a state an attacker can
 *      sometimes cause.
 *
 *   2. Fail closed for the expensive endpoints; a bounded emergency allowance
 *      for mailgun-send and send-sms. Rejected too, and correctly: the
 *      allowance lived in a Map inside one Deno isolate, so concurrent and
 *      cold-started isolates each got their own. "20 per 5 minutes" was never
 *      cluster-wide. A per-isolate ceiling described as a global one is worse
 *      than no ceiling, because it reads like a bound in the code, in the
 *      tests and in the documentation.
 *
 *   3. Fail closed everywhere — which is what the operational argument
 *      supports anyway. gl_rate_limit_hit shares a database with the invoices
 *      mailgun-send exists to email. While it is down there is nothing to send.
 *
 * This file therefore asserts the ABSENCE of a spending path, which is the
 * awkward kind of test to write: it has to fail if someone reintroduces one.
 *
 * It imports the shipped `rate-limit-policy.mjs`. An earlier version stripped
 * types out of rate-limit.ts with regexes instead, and the stripper rewrote
 * `{ degraded: why }` into `{ degraded }` — it parsed, so the parse guard
 * passed, and the assertions were running against a module unlike the deployed
 * one. Requiring the .ts is not an option either: CI runs Node 20, which cannot
 * strip types.
 *
 * Run:  node tests/rate-limit-outage.test.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');
const POLICY = path.join(SHARED, 'rate-limit-policy.mjs');
const TS = path.join(SHARED, 'rate-limit.ts');
const ENDPOINTS = ['ai-proxy', 'dropbox-sign', 'mailgun-send', 'send-sms'];

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

  check('rate-limit.ts imports the policy module',
    /from '\.\/rate-limit-policy\.mjs'/.test(raw),
    'if the decision is reimplemented in the .ts, this file stops testing the ' +
    'code that actually runs');
  check('every degraded path goes through degradedVerdict',
    (raw.match(/degradedVerdict\(/g) || []).length >= 3 &&
    !/allowed:\s*true,\s*degraded:/.test(raw),
    'a hand-rolled {allowed:true, degraded:…} in the wrapper is a fail-open ' +
    'that bypasses the policy entirely');
  check('a separate message exists for an outage refusal',
    /export function rateLimitOutageMessage/.test(raw));

  const policy = await import('file:///' + POLICY.split(path.sep).join('/'));
  const { degradedVerdict, permitsSpendingWhileDegraded } = policy;

  // The core property: nothing gets through, whatever is asked for.
  const attempts = [
    ['no options at all', undefined],
    ["policy 'closed'", { onOutage: 'closed' }],
    ["policy 'allowance' (the removed one)", { onOutage: 'allowance', outageAllowance: 20 }],
    ['a made-up policy', { onOutage: 'please' }],
    ['a huge allowance', { onOutage: 'allowance', outageAllowance: 1e9, outageWindowSeconds: 1 }],
  ];
  for (const [label, opts] of attempts) {
    const r = degradedVerdict('mailgun-send:u1', 'connection refused', opts);
    check('refused with ' + label,
      r.allowed === false && r.outage === true && !!r.degraded, JSON.stringify(r));
  }

  // Repeated calls must not find a budget. If someone reintroduces a counter,
  // the Nth call is where it would show up.
  let permitted = 0;
  for (let i = 0; i < 50; i++) {
    if (degradedVerdict('mailgun-send:u' + (i % 7), 'rpc 500', { onOutage: 'allowance' }).allowed) permitted++;
  }
  check('50 degraded calls across 7 users permit none of them',
    permitted === 0, permitted + ' were permitted');

  check('the reason is carried through for the log',
    degradedVerdict('x:1', 'rpc 503').degraded === 'rpc 503');

  check('permitsSpendingWhileDegraded still names the dangerous value',
    permitsSpendingWhileDegraded('allowance') === true &&
    permitsSpendingWhileDegraded('closed') === false,
    'the call-site check below relies on this helper meaning what it says');

  // ── no call site may ask to keep spending ────────────────────────────────
  console.log('');
  for (const fn of ENDPOINTS) {
    const s = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', fn, 'index.ts'), 'utf8');
    const declared = (s.match(/onOutage:\s*'([a-z]+)'/) || [])[1];
    check(fn + " declares onOutage: 'closed'", declared === 'closed',
      'declared: ' + declared);
    check(fn + ' declares no allowance', !permitsSpendingWhileDegraded(declared) &&
      !/outageAllowance/.test(s),
      'an allowance here would be a per-isolate bound presented as a global one');
    check(fn + ' answers an outage refusal with 503, not 429',
      /rateLimitOutageMessage\([^)]*\),\s*503/.test(s),
      'a 429 tells the caller they hit a limit; they did not');
  }

  // ── and the policy module itself offers no way back ──────────────────────
  console.log('');
  const psrc = fs.readFileSync(POLICY, 'utf8');
  check('the policy module holds no in-memory counter',
    !/new Map\(/.test(psrc) && !/allowanceUsed/.test(psrc),
    'a per-isolate Map is what made the previous bound illusory');
  check('degradedVerdict has exactly one return shape',
    (psrc.match(/return \{ allowed:/g) || []).length === 1 &&
    /return \{ allowed: false/.test(psrc),
    'a second return is where a permitted path would reappear');

  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})();
