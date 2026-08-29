/*
 * index-script-order.test.cjs — GL-037, step one.
 *
 * WHY THIS EXISTS
 * ---------------
 * index.html carried a single ~9,300-line inline <script>. It has been moved
 * verbatim into crm-index-core.js. The move is safe only because a classic
 * external script in the same document position behaves identically to an
 * inline one — and "same position" plus "classic" are both things a later edit
 * can break without any obvious symptom.
 *
 * CLAUDE.md is explicit that this file hardcodes order-dependent
 * root-absolute script tags and that a bulk move breaks the site. So the
 * ordering properties get asserted rather than remembered:
 *
 *   - crm-index-core.js loads exactly where the inline block used to, which is
 *     immediately after the Chart.js CDN tag and before every /crm-*.js
 *   - it carries no defer/async, either of which would run it AFTER the
 *     scripts that currently follow it and silently reorder everything
 *   - index.html has no inline block again, which is what the CSP work needs
 *   - the tag is root-absolute, because Vercel serves from the repo root
 *
 * Run:  node tests/index-script-order.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('index.html script order — the extraction must not reorder anything\n');

// Every <script> tag in document order, with its attributes.
const tags = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
const srcs = tags
  .map((a) => (a.match(/\bsrc="([^"]+)"/) || [])[1])
  .filter(Boolean);

check('the core script is loaded by index.html',
  srcs.includes('/crm-index-core.js'),
  'the extracted file must actually be referenced, or the CRM is simply gone');

check('the core script file exists',
  fs.existsSync(path.join(ROOT, 'crm-index-core.js')));

check('index.html has no inline script block',
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].length === 0,
  'a new inline block reintroduces what the extraction removed, and what the ' +
  "CSP's 'unsafe-inline' allowance exists for");

// ── position ─────────────────────────────────────────────────────────
const coreAt = srcs.indexOf('/crm-index-core.js');
const chartAt = srcs.findIndex((s) => /chart\.js|chart\.umd/i.test(s));
check('the core script sits immediately after the Chart.js tag',
  chartAt !== -1 && coreAt === chartAt + 1,
  'chart at ' + chartAt + ', core at ' + coreAt +
  ' — the inline block occupied exactly that slot, and code in it runs ' +
  'against Chart being already defined');

const firstCrm = srcs.findIndex((s) => /^\/crm-(?!index-core)/.test(s));
check('the core script loads before every other /crm-*.js',
  firstCrm === -1 || coreAt < firstCrm,
  'core at ' + coreAt + ', first other crm module at ' + firstCrm +
  ' — the modules read globals this file declares');

check('the core script is referenced root-absolutely',
  /src="\/crm-index-core\.js"/.test(html),
  'Vercel serves from the repo root; a relative path breaks on nested routes');

// ── modules extracted out of the core (GL-037) ───────────────────────
// Each capability pulled out of crm-index-core.js gets its own tag. The
// core still calls into them — renderArAgingSection() from openReports(),
// openArAging() from an onclick — so a module that loads BEFORE the core,
// or that defers, breaks those calls. Same contract as the core itself.
const modules = srcs.filter((x) => x.startsWith('/src/'));
check('every extracted module loads after the core script',
  modules.every((m) => srcs.indexOf(m) > coreAt),
  'modules: ' + modules.join(', ') + ' — the core calls into them, so they ',
);
for (const m of modules) {
  const mTag = tags.find((a) => a.includes(m)) || '';
  check('module is classic and blocking: ' + m,
    !/\bdefer\b|\basync\b|type="module"/.test(mTag),
    'its onclick= handlers resolve against window, which only a classic '
    + 'top-level declaration populates');
  check('module exists on disk: ' + m,
    fs.existsSync(path.join(ROOT, m.slice(1))));
}
// Every module on disk must actually be loaded. A file anywhere under src/
// with no script tag is dead weight that looks like shipped code — the same
// shape as a test wired to no workflow (GL-039).
function walkModules(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = dir + '/' + e.name;
    if (e.isDirectory()) walkModules(full, acc);
    else if (e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}
const onDisk = fs.existsSync(path.join(ROOT, 'src'))
  ? walkModules(path.join(ROOT, 'src'), []).map((f) =>
      '/' + path.relative(ROOT, f).split(path.sep).join('/'))
  : [];
const unloaded = onDisk.filter((f) => !srcs.includes(f));
check('every module on disk is loaded by index.html',
  unloaded.length === 0,
  unloaded.join(', ') + ' — present but referenced by no script tag');

// The core carries one manifest of what was extracted. Scattered 'moved to'
// comments were the earlier scheme and they did not survive: an extraction
// whose boundary ran to the next banner swallowed the previous pointer, and
// eight ended up inside module files, reading as if the module had something
// to do with the section named.
check('no module contains a stray "moved to" pointer',
  onDisk.every((f) =>
    !/moved to \/src\/modules/.test(fs.readFileSync(path.join(ROOT, f.slice(1)), 'utf8'))),
  'a pointer inside a module points away from the code it sits next to');
check('the core lists every extracted module in its manifest',
  onDisk.every((f) => fs.readFileSync(path.join(ROOT, 'crm-index-core.js'), 'utf8').includes(f)),
  'the manifest is how someone reading the core finds where a capability went');
// The agreed taxonomy (GL-037): business capabilities under
// src/modules/<domain>/, infrastructure under src/services/, cross-cutting
// helpers under src/shared/. There is exactly ONE shared location -- there
// were briefly two, src/modules/shared and src/shared, which is the kind of
// ambiguity that makes people file things by coin toss.
check('there is no second shared folder under src/modules',
  !fs.existsSync(path.join(ROOT, 'src/modules/shared')),
  'src/shared is the one shared location; two of them means neither is the rule');
const ALLOWED_ROOTS = ['src/modules', 'src/services', 'src/shared'];
const strays = onDisk.filter((f) =>
  !ALLOWED_ROOTS.some((r) => f.startsWith('/' + r + '/')));
check('every file under src/ sits in modules, services or shared',
  strays.length === 0,
  strays.join(', ') + ' — a fourth location means the taxonomy is not a rule');
// GL-037 is finished: every capability lives under src/, and the only
// crm-*.js left at the repo root is the entry point everything loads after.
//
// Without this check the structure erodes the easy way -- someone adds one
// file at the root because that is where the others used to be, then the
// next person copies them. Naming the single exception makes adding a
// second one a decision rather than a drift.
const rootCrm = fs.readdirSync(ROOT).filter((f) => /^crm-.*\.js$/.test(f)).sort();
check('crm-index-core.js is the only crm-*.js at the repo root',
  rootCrm.length === 1 && rootCrm[0] === 'crm-index-core.js',
  'found: ' + rootCrm.join(', ') + ' — everything else belongs under src/');

// The scaffold's domain folders are the taxonomy. An empty one is honest
// (nothing in this codebase is inventory management yet); a MISSING one
// means someone deleted a category rather than deciding about it.
for (const d of ['src/modules', 'src/services', 'src/shared']) {
  check('the ' + d + ' folder exists', fs.existsSync(path.join(ROOT, d)));
}
// ── it must stay a classic, blocking script ──────────────────────────
const coreTag = tags.find((a) => /\/crm-index-core\.js/.test(a)) || '';
check('the core script has no defer',
  !/\bdefer\b/.test(coreTag),
  'defer runs it after the scripts that follow it in the document — the exact ' +
  'reordering CLAUDE.md warns breaks this page');
check('the core script has no async',
  !/\basync\b/.test(coreTag),
  'async makes execution order nondeterministic');
check('the core script is not a module',
  !/type="module"/.test(coreTag),
  'a module is deferred and scoped: top-level declarations would stop being ' +
  'globals, and the 364 inline on* handlers in this file would stop resolving');

// ── the moved code must still be a plain classic script ──────────────
const core = fs.readFileSync(path.join(ROOT, 'crm-index-core.js'), 'utf8');
check('the core script declares the globals the markup calls',
  /\nfunction logoutCRM\(\)/.test(core) && /\nfunction esc\(/.test(core),
  'inline on* handlers resolve against window, which top-level function ' +
  'declarations in a classic script populate');
check('the core script contains no import/export',
  !/^\s*(import|export)\s/m.test(core),
  'either would force module semantics and break the globals contract above');

// ── every test file is actually wired into CI ────────────────────
// The workflow names each test as its own hand-written step, so a test can
// exist, pass locally, and never run on any push. That is worse than having
// no test: the file reads as coverage and the run is green for a property
// nothing checked.
//
// Comment lines are stripped first — a workflow that merely MENTIONS a test
// file in a comment must not count as running it. (Three tests in this repo
// have already been broken by prose matching the thing they searched for.)
const wfDir = path.join(ROOT, '.github', 'workflows');
const workflowRuns = fs.readdirSync(wfDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => fs.readFileSync(path.join(wfDir, f), 'utf8'))
  .map((y) => y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'))
  .join('\n');

const orphanTests = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.cjs'))
  .filter((f) => !workflowRuns.includes('tests/' + f));

check('every tests/*.test.cjs is run by a workflow',
  orphanTests.length === 0,
  orphanTests.join(', ') +
  '\n          Add a step to .github/workflows/smoke-test.yml. An unwired ' +
  'test looks like coverage and provides none.');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
