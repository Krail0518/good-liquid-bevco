/*
 * booking-email-escaping.test.cjs — GL-006, the half that stayed open.
 *
 * WHY THIS EXISTS
 * ---------------
 * booking-confirm builds two emails from data an anonymous caller supplies.
 * #296 added an ingestion strip:
 *
 *     const stripAngles = (v) => String(v ?? '').replace(/[<>]/g, '');
 *     const safeName = stripAngles(booker_name).trim();
 *
 * That closed most of it, and the register said so — "partly fixed; template
 * escaping still open". The remaining hole was concrete, not theoretical:
 *
 * booker_email was the one field stripAngles never touched. It was validated
 * instead, by /^[^@\s]+@[^@\s.]+\.[^@\s]+$/ — a pattern that excludes only '@'
 * and whitespace. Neither is needed to build a payload, because HTML tolerates
 * '/' as an attribute separator:
 *
 *     a<svg/onload=alert(1)>@b.co
 *
 * That passes the regex, and it was interpolated raw into the host approval
 * email — the message carrying the Approve link a staff member clicks.
 *
 * The fix GL-006 actually asked for is escaping at the template, and that is
 * what this file guards. The ingestion strip stays as defence in depth, but it
 * cannot be the fix: it never covered booker_email, it does not touch '&' (so
 * "Tom & Jerry" can still form an entity), and it says nothing about values
 * arriving from elsewhere — hostName comes from a staff profile row.
 *
 * This test EXECUTES the regex and the escape function lifted out of the real
 * source, so it cannot pass against a version where they were quietly relaxed.
 *
 * Run:  node tests/booking-email-escaping.test.cjs
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(
  __dirname, '..', 'supabase', 'functions', 'booking-confirm', 'index.ts'
);
// Normalised to LF: the source is CRLF on Windows, and every extraction
// pattern below spans lines.
const src = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('booking-confirm — escape at the template, not only at ingestion\n');

// ── the address filter, executed ─────────────────────────────────────
const PAYLOADS = [
  'a<svg/onload=alert(1)>@b.co',
  'x<img/src=x/onerror=alert(1)>@y.io',
  '"onmouseover=alert(1)"@z.co',
  "a'@b.co",
];
const HARMLESS = [
  'mike@krail.us',
  'first.last+tag@sub.example.com',
  "o'brien@example.com".replace("'", ''),   // apostrophes are rejected; use the plain form
];

const rejectMatch = src.match(/if \(\/(\[[^\n]*?\])\/\.test\(String\(booker_email\)\)\) \{/);
check('an explicit reject for HTML-significant characters in the address exists',
  !!rejectMatch,
  'the shape/description regex changed — update this test rather than deleting it');

if (rejectMatch) {
  // eslint-disable-next-line no-eval
  const REJECT = new RegExp(rejectMatch[1]);
  for (const p of PAYLOADS) {
    check('address rejected: ' + p.slice(0, 40), REJECT.test(p),
      'this passes the e-mail shape regex and would reach the approval email');
  }
  for (const g of HARMLESS) {
    check('address still accepted: ' + g, !REJECT.test(g),
      'a real address must not be turned away by the guard');
  }
}

// The original shape check is kept — this asserts it was NOT relied on alone,
// by proving it does accept a payload.
const SHAPE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
check('the shape regex alone would have accepted a payload (why the guard is needed)',
  SHAPE.test('a<svg/onload=alert(1)>@b.co'),
  'if this ever stops being true the extra guard can be revisited');

// ── the escape function, executed ────────────────────────────────────
console.log('');
const escMatch = src.match(/const escapeHtml = \(v: unknown\) =>\n([\s\S]*?);\n/);
check('escapeHtml exists in booking-confirm', !!escMatch,
  'GL-006 asked for escaping at the template; ingestion stripping is not it');

if (escMatch) {
  const body = escMatch[1].replace(/String\(v \?\? ''\)/, "String(v == null ? '' : v)");
  // eslint-disable-next-line no-new-func
  const escapeHtml = new Function('v', 'return ' + body + ';');
  const cases = [
    ['<script>alert(1)</script>', '<'],
    ['" onmouseover="alert(1)', '"'],
    ["' onfocus='alert(1)", "'"],
  ];
  for (const [input, ch] of cases) {
    const out = escapeHtml(input);
    check('escapes ' + JSON.stringify(ch) + ' in: ' + input.slice(0, 30),
      !out.includes(ch),
      'got: ' + out.slice(0, 60));
  }

  // '&' cannot use the rule above: correct output is "Tom &amp; Jerry", which
  // necessarily contains '&'. What must not survive is a BARE ampersand — one
  // that is not already the start of an entity this function produced.
  const amp = escapeHtml('Tom & Jerry');
  check('escapes a bare "&" without breaking the entity it produces',
    amp === 'Tom &amp; Jerry' && !/&(?!(amp|lt|gt|quot|#39);)/.test(amp),
    'got: ' + amp);
  check('escapeHtml handles & first, so entities are not double-broken',
    escapeHtml('<') === '&lt;' && escapeHtml('&lt;') === '&amp;lt;',
    'got: ' + escapeHtml('<') + ' / ' + escapeHtml('&lt;'));
}

// ── every user value in an HTML template is escaped ──────────────────
console.log('');
// Pull just the HTML template literals. The plain-text bodies deliberately use
// the unescaped values: entities render literally in a text/plain part, so
// escaping there would corrupt the message rather than protect anything.
const htmlBlocks = [...src.matchAll(/const \w*[Hh]tml = `([\s\S]*?)`;\n/g)].map((m) => m[1]);
check('both HTML templates were found', htmlBlocks.length >= 2,
  'found ' + htmlBlocks.length);

const RAW = ['safeName', 'safeCompany', 'safeNotes', 'booker_email', 'hostName',
             'approveUrl', 'declineUrl'];
const leaked = [];
for (const block of htmlBlocks) {
  for (const name of RAW) {
    if (new RegExp('\\$\\{' + name + '[}\\s]').test(block) ||
        new RegExp("\\$\\{" + name + " \\? ").test(block)) {
      leaked.push(name);
    }
  }
}
check('no unescaped user value is interpolated into an HTML template',
  htmlBlocks.length >= 2 && leaked.length === 0,
  htmlBlocks.length < 2
    ? 'the templates could not be extracted, so this proves nothing — fix the extraction'
    : 'raw in HTML: ' + [...new Set(leaked)].join(', '));

for (const v of ['eName', 'eEmail']) {
  check('the HTML templates use the escaped ' + v,
    htmlBlocks.some((b) => b.includes('${' + v)),
    'expected the escaped form to appear in a template');
}

// ── the ingestion strip must stay ────────────────────────────────────
console.log('');
check('stripAngles is still applied at ingestion (defence in depth)',
  /const stripAngles/.test(src) && /stripAngles\(booker_name\)/.test(src),
  'escaping at the template is the fix, but the strip keeps payloads out of storage');
check('what gets persisted is still the stripped value',
  /booker_name:\s*safeName/.test(src) && /notes:\s*safeNotes/.test(src),
  'the row feeds src/modules/pipeline/calendar.js, which tests/calendar-xss.test.cjs covers');

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
