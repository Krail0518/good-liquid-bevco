#!/usr/bin/env node
/* ============================================================================
   REALTIME CHANNELS — a channel must not remove itself from its own callback
   ----------------------------------------------------------------------------
   WHY THIS EXISTS (GL-084)

   error_log held 275 "Maximum call stack size exceeded" rows between 7 Aug
   and 3 Sep 2026, every stack inside supabase.min.js's channel code
   (leave -> unsubscribe -> trigger -> leave). It read like a library bug, and
   GL-046 treated it as one: it added a silent .catch() to the rejection. The
   log went quiet a few days later, which looked like a fix.

   It was not. The recursion was in the app. The invoices realtime handler
   removed the channel when its status callback saw CLOSED, and removing a
   channel emits CLOSED to that same callback. Reproduced live against
   production on 2026-09-16: one external close fired the callback 52 times and
   called removeChannel 50 times before a safety cap stopped it — without the
   cap the browser tab froze. With a per-channel guard and the removal deferred
   out of the callback: 3 callbacks, 1 removal, channel gone.

   The lesson is the one this codebase keeps relearning in different costumes:
   silencing an error is not the same as fixing it, and a quiet log only means
   something if the thing that used to write to it has actually stopped.

   WHAT IT CHECKS

   Every `.subscribe(function(status){...})` callback that calls removeChannel
   or unsubscribe must (a) return early on a guard before it does, and
   (b) make the call from a setTimeout rather than synchronously inside the
   callback. The "the scan found anything" guard stops a renamed call from
   turning this into a vacuous pass.

   Run:  node tests/realtime-channels.test.cjs
   ========================================================================== */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + detail);
}

console.log('\nREALTIME CHANNELS\n');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+)"/g)]
  .map(m => m[1]).filter(s => !/^https?:/.test(s)).map(s => s.replace(/^\//, ''))
  .filter(f => f !== 'supabase.min.js' && fs.existsSync(path.join(ROOT, f)));

// Pull out the body of each status callback by brace matching from its opening.
function callbackBodies(src) {
  const out = [];
  const re = /\.subscribe\(\s*function\s*\(\s*status\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex;
    for (; i < src.length && depth; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    out.push(src.slice(re.lastIndex, i - 1));
  }
  return out;
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let callbacksSeen = 0, removingCallbacks = 0;
for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const body of callbackBodies(src)) {
    callbacksSeen++;
    const callIdx = body.search(/removeChannel\(|\.unsubscribe\(/);
    if (callIdx < 0) continue;
    removingCallbacks++;
    const before = body.slice(0, callIdx);
    check(f + ': guards against its own CLOSED before removing the channel',
      /if\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*return\s*;/.test(before),
      'removing a channel emits CLOSED to this same callback; without an early return it recurses until the stack overflows');
    const deferred = /setTimeout\(\s*function\s*\(\s*\)\s*\{[^}]*$/.test(before.slice(-400)) ||
                     /setTimeout\(\s*function\s*\(\s*\)\s*\{[\s\S]{0,300}?(removeChannel\(|\.unsubscribe\()/.test(body);
    check(f + ': removes the channel outside its own callback',
      deferred,
      'a synchronous removeChannel re-enters the library mid-dispatch');
  }
}

check('the scan found status callbacks to check at all',
  callbacksSeen > 0,
  'no .subscribe(function(status){…}) found — the pattern changed shape and every check above is vacuous');
check('at least one callback that removes its channel was examined',
  removingCallbacks > 0,
  'the invoices realtime handler (help-features.js) should be one; if it moved, re-point this test');

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
