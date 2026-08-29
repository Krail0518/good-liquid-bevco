/*
 * supply-chain-pinning.test.cjs — the third-party code this project runs must
 * be pinned, and the secret-scanner's allowlist must not be able to hide the
 * one finding that matters.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo has no package.json, no lockfile, and no node_modules — on purpose.
 * Vercel serves it as a static site from the root, and the smoke workflow
 * installs Playwright into /tmp precisely so a package.json can never appear
 * here and change the deploy.
 *
 * The consequence is that every off-the-shelf dependency scanner is blind to
 * it. `npm audit` has nothing to read. Dependabot can only see the workflow
 * files. But the project very much does run third-party code:
 *
 *   - a <script> tag pulling Chart.js from jsDelivr, into staff sessions
 *   - 18 edge functions importing @supabase/supabase-js from esm.sh, ALL of
 *     which hold SUPABASE_SERVICE_ROLE_KEY
 *
 * The second one is the sharp edge. service_role bypasses RLS completely, so
 * whatever esm.sh serves for that import runs with unrestricted access to every
 * client's data — the exact outcome CLAUDE.md calls the worst this system can
 * produce. A floating `@2` specifier means the code that runs tomorrow is not
 * the code that was reviewed today, and no scanner in the ecosystem would ever
 * tell us.
 *
 * WHAT IS ASSERTED, AND WHAT IS BASELINED
 * ---------------------------------------
 * The esm.sh imports are now pinned (GL-046, all 18 functions), so that
 * baseline is zero and a reintroduced floating specifier fails immediately.
 *
 * The CDN Subresource Integrity gap (GL-047) is still frozen at its current
 * count rather than fixed: a wrong integrity hash blocks the script site-wide,
 * so it needs a hash taken from the served file and a browser check, which is
 * its own change. This cannot get WORSE meanwhile.
 *
 * Run:  node tests/supply-chain-pinning.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

console.log('supply chain — pinning and scanner integrity\n');

/* ── 1. remote imports in edge functions ──────────────────────────── */
// A specifier is "floating" when it names a major only (@2) or nothing at all,
// so the resolved build can change without any commit here.
const fnFiles = walk(path.join(ROOT, 'supabase', 'functions'))
  .filter((f) => f.endsWith('.ts'));

const remoteImports = [];
for (const f of fnFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /['"](https?:\/\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Only import specifiers, not URLs used as data (API endpoints).
    const before = src.slice(Math.max(0, m.index - 80), m.index);
    if (!/\b(import|from)\b[^;]*$/.test(before)) continue;
    remoteImports.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), url: m[1] });
  }
}

// Exact version = at least major.minor.patch after the last @.
const isPinned = (u) => /@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?(?:\/|$|\?)/.test(u);
const floating = remoteImports.filter((r) => !isPinned(r.url));
const floatingUrls = [...new Set(floating.map((r) => r.url))];

// GL-046 is FIXED: all 18 edge functions were pinned to
// @supabase/supabase-js@2.112.4 (the exact build esm.sh already served for
// @2, so the change was behaviour-preserving by construction). The baseline is
// therefore ZERO, and any reintroduced floating specifier fails immediately.
//
// It stays zero. Anything imported into a function holding
// SUPABASE_SERVICE_ROLE_KEY must name an exact version, because that key
// bypasses RLS entirely.
const BASELINE_FLOATING_FILES = 0;
const BASELINE_FLOATING_URLS = 0;

check('no NEW floating remote import in an edge function',
  floating.length <= BASELINE_FLOATING_FILES,
  'floating imports rose to ' + floating.length + ' (baseline ' + BASELINE_FLOATING_FILES + ')' +
  '\n          ' + floatingUrls.join('\n          ') +
  '\n          Pin to an exact version. These functions run with ' +
  'SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely.');

check('no NEW distinct floating specifier',
  floatingUrls.length <= BASELINE_FLOATING_URLS,
  'distinct floating specifiers: ' + floatingUrls.join(', '));

// The baseline must shrink as the pinning work lands, not sit stale.
if (floating.length < BASELINE_FLOATING_FILES) {
  console.log('  NOTE  floating imports are down to ' + floating.length +
    ' (baseline ' + BASELINE_FLOATING_FILES + ') — lower BASELINE_FLOATING_FILES to lock the gain in');
}

/* ── 2. CDN <script> tags ─────────────────────────────────────────── */
// A CDN script runs with full authority in staff sessions. Subresource
// Integrity means a compromised or swapped file simply does not execute.
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const cdnTags = [];
for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(src)) !== null) cdnTags.push({ file: f, tag: m[0], url: m[1] });
}

const cdnNoSri = cdnTags.filter((t) => !/\bintegrity=/.test(t.tag));

// Frozen 2026-08-29: 1 (chart.js@4.4.2 from jsDelivr). May only go DOWN.
const BASELINE_CDN_NO_SRI = 1;

check('no NEW cross-origin script without Subresource Integrity',
  cdnNoSri.length <= BASELINE_CDN_NO_SRI,
  cdnNoSri.map((t) => t.file + ' -> ' + t.url).join('\n          ') +
  '\n          Add integrity="sha384-…" crossorigin="anonymous". Without it a ' +
  'CDN compromise executes arbitrary script in staff sessions.');

// Version-pinning is separate from SRI, and this one IS already satisfied.
const cdnUnversioned = cdnTags.filter((t) => !/@\d+\.\d+\.\d+/.test(t.url));
check('every CDN script names an exact version',
  cdnUnversioned.length === 0,
  cdnUnversioned.map((t) => t.url).join(', '));

/* ── 3. the secret scanner's allowlist cannot hide a service_role key ── */
// This is the part of the scanner most likely to rot. Broadening the allowlist
// is a one-line change that makes the whole job decorative, and nothing about
// a green build would reveal it.
//
// The trap is concrete: a service_role token and an anon token for the SAME
// project encode to a byte-identical base64 prefix and only diverge 73
// characters in. An allowlist keyed on `{"iss":"supabase"` would match both.
const cfg = fs.readFileSync(path.join(ROOT, '.gitleaks.toml'), 'utf8');
const allowRegexes = (() => {
  const start = cfg.indexOf('[allowlist]');
  if (start === -1) return [];
  let body = cfg.slice(start);
  const from = body.indexOf('regexes');
  if (from === -1) return [];
  body = body.slice(from);
  // Stop at the next key, NOT at the first ']' — the patterns themselves
  // contain ']' (e.g. [A-Za-z0-9_-]+), which silently truncated an earlier
  // version of this parser to zero results. Zero results then made the
  // service_role assertion below pass vacuously, which is the failure mode
  // this whole section exists to prevent.
  const end = body.search(/\n\s*(paths|stopwords|commits)\s*=/);
  if (end !== -1) body = body.slice(0, end);
  return [...body.matchAll(/'''([\s\S]*?)'''/g)].map((m) => m[1].trim());
})();

check('.gitleaks.toml declares an allowlist',
  allowRegexes.length > 0,
  'no allowlist regexes parsed — the publishable key would fail every build');

// Build both tokens for the real project and run them through the allowlist.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const HEAD = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const SIG = 'c2lnbmF0dXJlX3BsYWNlaG9sZGVyX3ZhbHVl';
const claims = (role) => ({
  iss: 'supabase', ref: 'ufjkeqmxwuyhbqyugcgg', role, iat: 1778342609, exp: 2093918609,
});
const anonToken = HEAD + '.' + b64url(claims('anon')) + '.' + SIG;
const svcToken = HEAD + '.' + b64url(claims('service_role')) + '.' + SIG;

const allowed = (s) => allowRegexes.some((r) => { try { return new RegExp(r).test(s); } catch (e) { return false; } });

check('the public anon key IS allowlisted',
  allowed(anonToken),
  'it would fail every build, and a permanently red scan is one everybody ' +
  'learns to ignore');

check('a service_role key is NOT allowlisted',
  allowRegexes.length > 0 && !allowed(svcToken),
  'the allowlist matches a service_role token for this project. That is a ' +
  'full RLS bypass — every client\'s data — and the scanner would stay ' +
  'silent about it. Pin the allowlist to the base64 of "role":"anon".');

check('the publishable key is allowlisted',
  allowed('sb_publishable_-37mkPexampleexample'),
  'the key that ships in page source by design would fail every build');

console.log('');
console.log('  edge-function remote imports : ' + remoteImports.length +
  ' (' + floating.length + ' floating)');
console.log('  CDN script tags              : ' + cdnTags.length +
  ' (' + cdnNoSri.length + ' without SRI)');
console.log('  gitleaks allowlist regexes   : ' + allowRegexes.length);

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
