/*
 * migration-replayable.test.cjs — can this repository rebuild its own database?
 *
 * WHY THIS EXISTS
 * ---------------
 * The answer was no, and nobody knew. A staging project was created and the
 * history replayed into it; it failed on the FIRST migration with
 *
 *     ERROR: relation "public.profiles" does not exist
 *
 * Ten core tables — profiles, clients, invoices, deals among them — existed in
 * production and in no migration at all (GL-055). Restoring from the repo alone
 * was impossible, and that would only have been discovered at the worst
 * possible moment.
 *
 * Fixing it surfaced three more things, each of which this file now pins:
 *
 *   GL-057  ~30 files shared a date-only version prefix. The CLI derives a
 *           migration's version from the filename, so `supabase db push`
 *           collided on schema_migrations_pkey at the second one.
 *   GL-057  Two pairs sorted alphabetically into the WRONG dependency order —
 *           customer_portal ran before the file creating the table it uses.
 *   GL-056  One file used a BACKSLASH-escaped apostrophe inside an ordinary SQL
 *           string, which is a syntax error under standard_conforming_strings.
 *           It was committed, looked fine, and had never executed as written.
 *
 * None of these could be seen by reading a migration on its own. They are
 * properties of the SET, which is why they need a test rather than review.
 *
 * This is a STATIC check — it does not need a database. The live proof is a
 * replay into a scratch Supabase project, which is how all of the above were
 * found in the first place; this file stops them coming back.
 *
 * Run:  node tests/migration-replayable.test.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'supabase/migrations');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('Migration history — can the repo rebuild the database?\n');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
console.log('    (' + files.length + ' migrations)');

// ── 1. Every filename yields a unique, CLI-parseable version ──────────
const versions = new Map();
const badNames = [];
for (const f of files) {
  const m = /^(\d{14})_/.exec(f);
  if (!m) { badNames.push(f); continue; }
  const v = m[1];
  if (versions.has(v)) versions.set(v, versions.get(v).concat(f));
  else versions.set(v, [f]);
}

check('every migration is named <14-digit timestamp>_name.sql',
  badNames.length === 0,
  badNames.join(', ') +
  '\n          The Supabase CLI takes the version from this prefix. A shorter ' +
  'one (20260516_x.sql) still parses, but two files on the same DAY then share ' +
  'a version and the second fails on schema_migrations_pkey.');

const dupes = [...versions.entries()].filter(([, list]) => list.length > 1);
check('no two migrations share a version',
  dupes.length === 0,
  dupes.map(([v, list]) => v + ': ' + list.join(' + ')).join('; '));

// ── 2. Nothing uses a table before something creates it ───────────────
// Only forms that definitely require the table to exist already. Comments are
// stripped first: a table named in prose creates nothing and requires nothing.
const IGNORE_SCHEMA = /^(auth|storage|extensions|cron|net|vault|graphql|realtime|supabase_migrations|information_schema|pg_catalog)\./i;
const created = new Set();
const forwardRefs = [];

for (const f of files) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // A file may reference what it itself creates, so collect first.
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi)) {
    created.add(m[1].toLowerCase());
  }

  const refs = new Map();
  const note = (name, how) => {
    if (IGNORE_SCHEMA.test(how)) return;
    const t = String(name).toLowerCase();
    if (t && !refs.has(t)) refs.set(t, how.replace(/\s+/g, ' ').slice(0, 48));
  };
  for (const m of sql.matchAll(/\bon\s+public\.([a-zA-Z_][\w]*)/gi)) note(m[1], m[0]);
  for (const m of sql.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?public\.([a-zA-Z_][\w]*)/gi)) note(m[1], m[0]);

  for (const [t, how] of refs) {
    if (!created.has(t)) forwardRefs.push(f + ' -> ' + t + '   (' + how + ')');
  }
}

check('no migration uses a table before one creates it',
  forwardRefs.length === 0,
  forwardRefs.slice(0, 6).join('\n          ') +
  (forwardRefs.length > 6 ? '\n          …and ' + (forwardRefs.length - 6) + ' more' : '') +
  '\n          Either the creating migration sorts AFTER this one, or nothing ' +
  'creates the table at all. The second case is GL-055: ten core tables lived ' +
  'only in production.');

// ── 3. No backslash-escaped quotes in live SQL ────────────────────────
// Valid in some dialects, a syntax error in Postgres with
// standard_conforming_strings on (the default). GL-056 shipped one.
const BACKSLASH_QUOTE = String.fromCharCode(92) + "'";
const escaped = [];
for (const f of files) {
  fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.trim().startsWith('--')) return;             // prose may say anything
    if (line.includes(BACKSLASH_QUOTE)) escaped.push(f + ':' + (i + 1));
  });
}

check('no backslash-escaped quotes in live SQL',
  escaped.length === 0,
  escaped.join(', ') +
  '\n          Postgres reads \\\' as backslash-then-end-of-string under ' +
  'standard_conforming_strings. Double the quote instead ( \'\' ). GL-056 was ' +
  'a committed migration that could never have run.');

// ── 3b. No LONE $ where a dollar-quote tag belongs ────────────────────
// A dollar-quoted block opens with a TAG — $$ or $name$. A single $ is a
// syntax error.
//
// This is not hypothetical and not a typo. Commit c17c5f4 amended
// 20260721_tour_alerts.sql using a script whose replacement string contained
// $$, and JavaScript's String.replace() treats $$ in a replacement as an
// ESCAPE for a literal single $. Four dollar quotes were silently halved,
// leaving DO $ and END $;. Nothing caught it, because migrations are never
// replayed — it surfaced only when a from-scratch rebuild was attempted
// months later, and even then it first looked like a bug in the rebuild tool.
const loneDollar = [];
for (const f of files) {
  fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.trim().startsWith('--')) return;
    const opensBlock = /(^|\s)(do|as|end|return)\s*\$(\s|;|$)/i.test(line);
    const bareLine = /^\s*\$\s*;?\s*$/.test(line);
    if (opensBlock || bareLine) loneDollar.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 60));
  });
}

check('no migration uses a lone $ where a dollar-quote tag belongs',
  loneDollar.length === 0,
  loneDollar.join('\n          ') +
  '\n          A block opens with $$ or $name$; a bare $ will not parse. If a ' +
  'script edited this file, check whether String.replace() ate one: $$ in a ' +
  'replacement string means a literal $.');

// ── 4. The bootstrap still creates the tables nothing else does ───────
// Not a guess at which tables matter: these are the ten that were found only in
// production, and the file that now creates them.
const BOOTSTRAP = files.find((f) => /_bootstrap_core_tables\.sql$/.test(f));
check('the bootstrap migration is still present and runs first',
  !!BOOTSTRAP && files.indexOf(BOOTSTRAP) === 0,
  BOOTSTRAP ? 'found, but it is not first — it must precede everything that ' +
              'references profiles, clients, invoices or deals'
            : 'missing — without it the history cannot rebuild the database (GL-055)');

if (BOOTSTRAP) {
  const boot = fs.readFileSync(path.join(DIR, BOOTSTRAP), 'utf8');
  const REQUIRED = ['profiles', 'clients', 'invoices', 'deals', 'activity',
                    'referrals', 'referrers', 'sales_decks', 'bottling_rates', 'canning_rates'];
  const absent = REQUIRED.filter((t) =>
    !new RegExp('create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.' + t + '\\b', 'i').test(boot));
  check('the bootstrap still creates all ten formerly-missing tables',
    absent.length === 0,
    'missing: ' + absent.join(', ') +
    '\n          These exist in production and in no other migration. Dropping ' +
    'one from the bootstrap silently makes the history unreplayable again.');
}

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
