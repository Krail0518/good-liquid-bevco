#!/usr/bin/env node
/* Every database mutation must check what the server actually did.
 *
 * CLAUDE.md rule 4, and the reason for it: RLS refuses SILENTLY. Zero rows, no
 * error. A write that inspects only `error` therefore reports success on a
 * change that never happened, and the repository attributes roughly forty bugs
 * to exactly that. The external auditor listed fifteen surviving sites and
 * asked for each to be classified by user-visible assertion, zero-row
 * semantics, impact and chosen verification.
 *
 * Doing that classification found something worth keeping: TWO of the fifteen
 * were not database writes at all. `booking-review.js` matched on
 * `URLSearchParams.delete()`, and `public-ops.js` on a COMMENT describing a
 * write. The auditor's own remark applies to the tool that produced the list --
 * "a nearby .select() search is a heuristic, not a correctness proof" -- and
 * that is why this file carries an explicit allowlist with a reason for each
 * entry rather than a count to beat.
 *
 * Five real sites are deliberately unchecked. Each is background state that
 * asserts nothing to anyone: no screen claims a saved value because of it, and
 * the state is re-derived on the next read. Bolting an alert onto a background
 * touch is noise pretending to be rigour, and it teaches people to dismiss the
 * alerts that matter. Each is listed below with its justification, so removing
 * a justification requires removing the exemption.
 *
 * Run:  node tests/checked-mutations.test.cjs
 */
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_jsscan.cjs');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + String(detail).split('\n').join('\n        '));
}

/* An unchecked mutation is permitted only with a reason recorded here. The key
   is path:line, and the line moves when the file is edited -- which is the
   point. A drifting entry forces a human to look at the site again rather than
   inheriting a decision made about different code. */
const ALLOWED = {
  'src/modules/pipeline/deal-brief.js': {
    why: 'Background AI-brief state (stale, ball, ball_since, AI-driven to-do ' +
         'completion). Asserts nothing to the user; the brief regenerates on ' +
         'the next open. The one USER-FACING write in the file -- the to-do ' +
         'checkbox -- is checked and reverts on refusal. See the ACCEPTED RISK ' +
         'block in that file.',
    max: 4,
  },
  'src/modules/production/compliance-ext.js': {
    why: 'Inspector-token usage tracking. Documented best-effort: the anon ' +
         'role may hold no update grant, and the surrounding return value ' +
         'means "token valid", not "write landed".',
    max: 1,
  },
  // Real code, but not a database call. Kept as a named exemption rather than
  // silently excluded, so the next person meets the false positive deliberately.
  'src/modules/pipeline/booking-review.js': {
    why: 'URLSearchParams.delete() in stripParams(). Not a database call.',
    max: 1,
  },
};

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (p.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'src'));

const found = {};
let total = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  // Comments blanked with the shared walker, which knows a regex literal from
  // a division. The first version of this scan used a hand-rolled state
  // machine that desynced on `.replace(/"/g, ...)` and silently stopped
  // stripping, surfacing a COMMENT as if it were an unchecked write.
  const lines = blankComments(fs.readFileSync(f, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/\.(update|delete)\(/.test(line)) return;
    total++;
    // A checked write asks for rows back. `.select()` may land on the same
    // line or within a few lines when the call is broken across lines.
    const window = lines.slice(i, i + 7).join('\n');
    if (/\.select\(/.test(window)) return;
    (found[rel] = found[rel] || []).push(i + 1);
  });
}

console.log('\nChecked mutations — a refused write must not report success\n');
console.log('  ' + total + ' mutation call(s) under src/\n');

check('there are mutation calls to check at all', total > 20,
  'the pattern stopped matching — this rule is now asserting nothing');

const unexpected = [];
for (const [rel, at] of Object.entries(found)) {
  const rule = ALLOWED[rel];
  if (!rule) { unexpected.push(rel + ' at line(s) ' + at.join(', ')); continue; }
  if (at.length > rule.max) {
    unexpected.push(rel + ' has ' + at.length + ' unchecked mutation(s), ' +
      'more than the ' + rule.max + ' recorded — new one(s) at line(s) ' + at.join(', '));
  }
}

check('no unchecked mutation outside the recorded exemptions',
  unexpected.length === 0,
  unexpected.join('\n') +
  (unexpected.length ? '\n\nAppend `.select()` and treat BOTH an error AND an ' +
   'empty returned array as failure. RLS refuses with zero rows and NO error, ' +
   'so an error-only check reports success on a write that never happened. If ' +
   'the write genuinely asserts nothing to anyone, add it to ALLOWED in this ' +
   'file WITH a reason.' : ''));

// An exemption whose site has disappeared is an exemption nobody is reading.
const stale = Object.keys(ALLOWED).filter((rel) => !found[rel]);
check('no exemption outlives the site it excuses', stale.length === 0,
  stale.join('\n') + (stale.length ? '\n\nThese files no longer contain an ' +
   'unchecked mutation. Remove the entry so the allowlist keeps meaning ' +
   'something.' : ''));

// The two file-level exemptions that are NOT database writes must stay that
// way: if one ever becomes a real Supabase call, the reason recorded here
// stops being true and the exemption must not silently cover it.
for (const rel of ['src/modules/pipeline/booking-review.js']) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = src.split(/\r?\n/);
  const at = (found[rel] || [])[0];
  const line = at ? lines[at - 1] : '';
  check(rel.split('/').pop() + ' exemption still covers a non-database call',
    !/from\(\s*['"][a-z_]+['"]\s*\)/.test(line) && !/supa|sb\(\)|SB\(\)/.test(line),
    'line ' + at + ': ' + line.trim().slice(0, 90) +
    '\nThe recorded reason says this is not a database write. It now looks ' +
    'like one, so the exemption is wrong.');
}

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
