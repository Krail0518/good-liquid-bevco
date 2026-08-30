/*
 * committed-secrets.test.cjs — GL-013. A secret in the repo is not a secret.
 *
 * WHY THIS EXISTS
 * ---------------
 * 20260721000000_tour_alerts.sql created the notify-deal shared secret like this:
 *
 *     PERFORM vault.create_secret(
 *       'gl-notify-2026-abc123',
 *       'gl_notify_secret',
 *       'Shared secret for notify-deal edge function'
 *     );
 *
 * That value authenticated the database's own triggers to an edge function,
 * and it was committed. Anyone with read access to the repository held the
 * credential. It is in git history permanently, so it can never be un-leaked —
 * only rotated, which 20260730002000 did on 2026-07-30.
 *
 * The reason to also fix the migration file is that migrations get replayed. A
 * fresh environment, or anyone running that one file, would re-create the
 * published credential and run on it until the later rotation happened to
 * follow. Vault's own API makes the safe form just as easy, so there is no
 * reason for a literal to appear here at all.
 *
 * Two guards, deliberately at different layers:
 *   * this test    — a literal cannot get back into a migration
 *   * SECRET facts in scripts/db-drift-snapshot.sql — production is not
 *     ACCEPTING a known-published value, whatever the repo says
 *
 * The second matters because the first cannot see a hand-edit in the
 * dashboard, which is exactly how the worst finding in this codebase happened.
 *
 * Run:  node tests/committed-secrets.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('committed secrets — a credential in the repo is public forever\n');

// ── no migration may pass a string literal as a secret VALUE ─────────
// vault.create_secret(value, name, description) — only the first argument is
// the secret. A literal name and description are fine and expected.
const offenders = [];
for (const f of fs.readdirSync(MIG).filter((x) => x.endsWith('.sql'))) {
  const src = fs.readFileSync(path.join(MIG, f), 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/create_secret\s*\(/i.test(line)) return;
    // The value may sit on this line or the next — both shapes occur.
    const window = (line + '\n' + (lines[i + 1] || '') + '\n' + (lines[i + 2] || ''));
    // Strip the call up to the opening paren, then look at the first argument.
    const after = window.slice(window.search(/create_secret\s*\(/i));
    const firstArg = after.replace(/^[\s\S]*?create_secret\s*\(\s*/i, '').split(/,|\)/)[0].trim();
    if (!firstArg) return;
    // A quoted literal is a committed secret. A generated expression is not.
    if (/^'[^']*'$/.test(firstArg)) {
      offenders.push(f + ':' + (i + 1) + '  value=' + firstArg.slice(0, 30));
    }
  });
}
check('no migration passes a string literal as a secret value',
  offenders.length === 0,
  offenders.join('\n          ') +
  '\n          use replace(gen_random_uuid()::text || gen_random_uuid()::text, \'-\', \'\') ' +
  'so the value never leaves Postgres');

// ── the specific published value must not be reintroduced ───────────
const LEAKED = 'gl-notify-2026-abc123';
const usedAsValue = [];
for (const f of fs.readdirSync(MIG).filter((x) => x.endsWith('.sql'))) {
  const src = fs.readFileSync(path.join(MIG, f), 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (!line.includes(LEAKED)) return;
    const t = line.trim();
    // Comments explaining the incident are the point. A detection comparison
    // (= '...' / in (...)) is a guard, not a use. Anything else is a use.
    if (t.startsWith('--')) return;
    if (/(=|in\s*\()/.test(t)) return;
    usedAsValue.push(f + ':' + (i + 1) + '  ' + t.slice(0, 80));
  });
}
check('the published literal is never used as a value again',
  usedAsValue.length === 0,
  usedAsValue.join('\n          '));

// ── the amended migration must carry its own guard ──────────────────
const tour = fs.readFileSync(path.join(MIG, '20260721000000_tour_alerts.sql'), 'utf8');
check('20260721000000_tour_alerts.sql generates the secret in-database',
  /gen_random_uuid\(\)/.test(tour),
  'it previously shipped the value as a literal');
check('20260721000000_tour_alerts.sql refuses to leave the published literal live',
  /RAISE EXCEPTION/i.test(tour) && tour.includes(LEAKED),
  'replaying it against a database that already holds the leaked value should fail loudly');

// ── production is watched, not just the repo ─────────────────────────
const snap = fs.readFileSync(path.join(ROOT, 'scripts', 'db-drift-snapshot.sql'), 'utf8');
check('the drift snapshot reports whether a published secret is live',
  /SECRET/.test(snap) && /known_published/.test(snap),
  'the repo guard cannot see a dashboard edit — that is how the worst finding here happened');
check('the drift snapshot never emits a secret value',
  !/decrypted_secret\s*\)?\s*(as line|\|\|)/.test(snap) &&
  /length\(decrypted_secret\)/.test(snap),
  'the snapshot is committed as the baseline, so it may record only a length and a boolean');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
