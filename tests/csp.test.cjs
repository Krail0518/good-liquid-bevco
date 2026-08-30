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
 *   2. The one that is knowingly weak should be recorded as such, with what it
 *      would actually take to remove, so it does not read as an oversight.
 *
 * script-src NO LONGER CARRIES 'unsafe-inline'
 * --------------------------------------------
 * It did until GL-DEF-01, which removed all 550 inline handler sites and the
 * inline <script> blocks. The checks that measured that exception are kept
 * below, now as ratchets: if a handler ever reappears, the count is printed,
 * and if somebody re-adds 'unsafe-inline' the justification check fails.
 *
 * Adding a nonce or a hash to script-src would be actively harmful: a CSP
 * carrying either causes browsers to IGNORE 'unsafe-inline'. That no longer
 * matters for script-src, but the assertion stays — it is free, and it
 * documents the trap.
 *
 * style-src STILL CARRIES 'unsafe-inline', AND WHY
 * ------------------------------------------------
 * Two different things need it, and only one has been dealt with:
 *
 *   style ELEMENTS (style-src-elem) — the 7 inline <style> blocks were moved
 *     to .css files and the 10 runtime document.createElement('style') calls
 *     moved into crm-runtime.css. Both are guarded below so they cannot come
 *     back. What still blocks tightening style-src-elem is the <style> blocks
 *     written into print/report popups: a window.open('') document inherits
 *     the opener's CSP — verified, not assumed, by writing an inline <script>
 *     into such a document against production and watching it not run — so
 *     those blocks would stop applying and compliance reports would print
 *     unstyled.
 *
 *   style ATTRIBUTES (style-src-attr) — roughly 6,000 style="..." attributes.
 *     A nonce cannot cover a style attribute; only 'unsafe-inline' does. This
 *     one is not going away without converting them all to classes.
 *
 * The security difference between the two is worth knowing, because it is why
 * the element half is worth chasing at all: a <style> ELEMENT can carry
 * attribute selectors, which is the primitive behind CSS keylogging and CSS
 * exfiltration. A style ATTRIBUTE applies only to the element it sits on and
 * cannot select anything, so it is a far weaker tool for an attacker.
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
console.log('    (raw on*=" text occurrences, comments included: ' + staticHandlers +
            ' markup + ' + jsHrefs + ' javascript: + ' + runtimeHandlers +
            ' in crm-*.js = ' + totalHandlers + ')');

// This is a RAW text count: it matches inside comments too. crm-index-core.js
// explains EXT-036 by quoting the two handlers it removed, which is why the
// number is 2 and not 0 with no handler anywhere in the codebase. Left raw on
// purpose — a comment-stripper is what blinded the dead-control scan once
// already — but that makes it useless as a justification, so the authority for
// "are there handlers" is tests/inline-handler-budget.test.cjs, whose budget is
// zero and which reads raw source for the same reason.
check("script-src does not carry 'unsafe-inline'",
  !script.includes("'unsafe-inline'"),
  'GL-DEF-01 removed all 550 handler sites to earn this. If it needs to come ' +
  'back, inline-handler-budget.test.cjs is the file that says why it is needed.');

check('index.html has no inline <script> element',
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].length === 0,
  'GL-037 extracted it; a new one would add a second reason to keep ' +
  "'unsafe-inline' beyond the handlers");

// ── style-src ────────────────────────────────────────────────────────
const style = directives['style-src'] || [];

check('style-src still allows the Google Fonts stylesheet host',
  style.includes('https://fonts.googleapis.com'),
  'got: ' + style.join(' '));

check('style-src does not allow arbitrary hosts',
  !style.includes('*') && !style.includes('https:'),
  'got: ' + style.join(' '));

// No page may carry an inline <style> element. These were extracted to .css
// files so that style-src-elem can eventually drop 'unsafe-inline'; a new one
// would silently re-add a reason to keep it.
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const withInlineStyle = PAGES.filter((f) =>
  /<style\b[^>]*>/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

check('no page has an inline <style> element',
  withInlineStyle.length === 0,
  withInlineStyle.join(', ') + '\n          Move it to a .css file and <link> it ' +
  'where the block was, so the cascade order does not change.');

// The same rule for CSS built at runtime: document.createElement('style') is a
// style ELEMENT too, and style-src-elem governs it exactly like a markup one.
// All ten former call sites now live in crm-runtime.css.
const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(path.join(ROOT, 'src'));
for (const f of fs.readdirSync(ROOT).filter((x) => /^crm-.*\.js$/.test(x))) {
  jsFiles.push(path.join(ROOT, f));
}

const injectors = jsFiles.filter((p) =>
  /createElement\(\s*['"]style['"]\s*\)/.test(fs.readFileSync(p, 'utf8')))
  .map((p) => path.relative(ROOT, p).split(path.sep).join('/'));

check('no module injects a <style> element at runtime',
  injectors.length === 0,
  injectors.join(', ') + '\n          Static CSS belongs in crm-runtime.css. ' +
  'A <style> element built at runtime is governed by style-src-elem exactly ' +
  'like one in markup, so this is what keeps the directive loose.');

// The remaining blocker, measured. Popups written with document.write inherit
// this document's CSP, so a <style> inside that HTML is subject to
// style-src-elem. Until these carry a <link> instead, the directive cannot
// drop 'unsafe-inline'. The count may shrink, never grow.
const POPUP_STYLE_BUDGET = 10;
const popupStyleSites = [];
for (const p of jsFiles) {
  const src = fs.readFileSync(p, 'utf8');
  src.split('\n').forEach((line, i) => {
    // a '<style' inside a JS string literal — i.e. HTML being generated
    if (/['"`][^'"`]*<style\b/.test(line)) {
      popupStyleSites.push(path.relative(ROOT, p).split(path.sep).join('/') + ':' + (i + 1));
    }
  });
}
console.log('    (<style> blocks generated into popups/reports: ' +
            popupStyleSites.length + ' of ' + POPUP_STYLE_BUDGET + ' allowed)');

check('generated <style> blocks are not increasing',
  popupStyleSites.length <= POPUP_STYLE_BUDGET,
  popupStyleSites.join(', ') + '\n          Budget is ' + POPUP_STYLE_BUDGET +
  '. Generate a <link rel="stylesheet"> pointing at location.origin instead — ' +
  "a popup is same-origin, so 'self' covers it.");

check("style-src 'unsafe-inline' is still justified",
  !style.includes("'unsafe-inline'") || popupStyleSites.length > 0 ||
    /style\s*=\s*"/i.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')),
  'nothing inline remains, so style-src can be tightened');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
