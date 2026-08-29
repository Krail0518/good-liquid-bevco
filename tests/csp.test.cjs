/*
 * csp.test.cjs — GL-DEF-01. Guards the Content-Security-Policy in vercel.json.
 *
 * WHY THIS EXISTS
 * ---------------
 * The CSP is a single long string in a JSON file. Nothing validates it, a typo
 * in one directive silently weakens or disables that directive, and the
 * failure is invisible in the browser — the page simply keeps working with
 * less protection. Two things follow:
 *
 *   1. The directives that are currently correct should stay correct.
 *   2. The one that is knowingly weak — script-src 'unsafe-inline' — should
 *      be recorded as such, with what it would actually take to remove, so it
 *      does not read as an oversight to the next person.
 *
 * WHY 'unsafe-inline' IS STILL HERE
 * ---------------------------------
 * GL-037 moved index.html's ~9,300-line inline <script> into
 * crm-index-core.js, so no inline <script> element remains. That is not what
 * keeps 'unsafe-inline' though. Inline EVENT HANDLERS need it too, and the
 * codebase has, measured:
 *
 *     234  on*="..." attributes in index.html markup
 *      21  href="javascript:..." links
 *     319  on*="..." handlers built inside JS template literals
 *     ---
 *     574  sites
 *
 * The 319 are generated at runtime with interpolated arguments
 * (onclick="deleteDoc('${d.id}')"), so no static rewrite reaches them.
 * Removing 'unsafe-inline' means a data-action dispatch layer and rewriting
 * every one of those templates — a change that would break the entire CRM if
 * it were done carelessly, and one that cannot be verified without a browser.
 *
 * Adding a nonce or a hash would be actively harmful here: a CSP that carries
 * either causes browsers to IGNORE 'unsafe-inline', which would disable all
 * 574 handlers at once. The test below asserts that mistake is not made while
 * the handlers still exist.
 *
 * Run:  node tests/csp.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('Content-Security-Policy\n');

const allHeaders = (vercel.headers || []).flatMap((h) => h.headers || []);
const cspHeader = allHeaders.find((h) => h.key === 'Content-Security-Policy');
check('a CSP header is configured', !!cspHeader);
if (!cspHeader) {
  console.log('\n1 CHECK(S) FAILED');
  process.exit(1);
}

const directives = {};
for (const part of cspHeader.value.split(';').map((s) => s.trim()).filter(Boolean)) {
  const [name, ...values] = part.split(/\s+/);
  directives[name] = values;
}

// ── the directives that must not regress ────────────────────────────
const required = {
  'default-src':   ["'self'"],
  'object-src':    ["'none'"],
  'base-uri':      ["'self'"],
  'form-action':   ["'self'"],
};
for (const [name, expected] of Object.entries(required)) {
  check(name + " is " + expected.join(' '),
    JSON.stringify(directives[name]) === JSON.stringify(expected),
    'got: ' + JSON.stringify(directives[name]));
}

check('upgrade-insecure-requests is present',
  Object.prototype.hasOwnProperty.call(directives, 'upgrade-insecure-requests'));

// frame-ancestors is the modern replacement for X-Frame-Options, which is
// deprecated. 'self' matches the X-Frame-Options: SAMEORIGIN already set, so
// having both is consistent rather than contradictory.
check('frame-ancestors is set',
  !!directives['frame-ancestors'],
  'X-Frame-Options is deprecated; browsers that ignore it had no clickjacking ' +
  'protection on a CRM holding staff sessions');
check('frame-ancestors agrees with X-Frame-Options',
  JSON.stringify(directives['frame-ancestors']) === JSON.stringify(["'self'"]) &&
  (allHeaders.find((h) => h.key === 'X-Frame-Options') || {}).value === 'SAMEORIGIN',
  'the two headers must not disagree about who may frame this site');

// ── connect-src must not become a wildcard ──────────────────────────
const connect = directives['connect-src'] || [];
check('connect-src does not allow arbitrary hosts',
  !connect.includes('*') && !connect.includes('https:'),
  'got: ' + connect.join(' ') + ' — this is the directive that limits where ' +
  'a successful injection could send data');
check('connect-src still allows the Supabase project',
  connect.some((c) => c.includes('ufjkeqmxwuyhbqyugcgg.supabase.co')),
  'the app cannot reach its own backend without this');

// ── the knowingly-weak part, held in place deliberately ─────────────
console.log('');
const script = directives['script-src'] || [];
check("script-src has no nonce",
  !script.some((v) => v.startsWith("'nonce-")),
  'a nonce makes browsers IGNORE unsafe-inline, which would disable all 574 ' +
  'inline handlers at once — remove the handlers first');
check('script-src has no hash',
  !script.some((v) => v.startsWith("'sha256-") || v.startsWith("'sha384-") || v.startsWith("'sha512-")),
  'same reason as the nonce check above');
check("script-src does not allow 'unsafe-eval'",
  !script.includes("'unsafe-eval'"),
  "'unsafe-inline' is a documented, measured exception; 'unsafe-eval' is not");
check('script-src does not allow arbitrary hosts',
  !script.includes('*') && !script.includes('https:'),
  'got: ' + script.join(' '));

// index.html no longer has an inline <script>, so if the handler count ever
// reaches zero this exception can go. Assert the reason still holds rather
// than leaving 'unsafe-inline' as a permanent unexplained weakness.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const staticHandlers = (html.match(/\son[a-z]+\s*=\s*"/gi) || []).length;
const jsHrefs = (html.match(/href\s*=\s*"javascript:/gi) || []).length;
let runtimeHandlers = 0;
for (const f of fs.readdirSync(ROOT).filter((x) => /^crm-.*\.js$/.test(x))) {
  runtimeHandlers += (fs.readFileSync(path.join(ROOT, f), 'utf8')
    .match(/\bon(click|change|input|submit|keyup|keydown|blur|focus|mouseover|mouseout|load|error)\s*=\s*["']/gi) || []).length;
}
const totalHandlers = staticHandlers + jsHrefs + runtimeHandlers;
console.log('    (inline handler sites: ' + staticHandlers + ' markup + ' +
            jsHrefs + ' javascript: + ' + runtimeHandlers + ' runtime = ' + totalHandlers + ')');

check("'unsafe-inline' is still justified by real inline handlers",
  !script.includes("'unsafe-inline'") || totalHandlers > 0,
  "no inline handlers remain, so script-src 'unsafe-inline' can finally be dropped");

check('index.html has no inline <script> element',
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].length === 0,
  'GL-037 extracted it; a new one would add a second reason to keep ' +
  "'unsafe-inline' beyond the handlers");

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
