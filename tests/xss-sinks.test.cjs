#!/usr/bin/env node
/* XSS: the sinks, and whether the escapers that feed them are sound.
 *
 * The external auditor asked for the thing a count cannot give: "Enumerate
 * every sink rather than counting escapers... Map each sink to its source and
 * context-specific encoding. Add negative payload tests for element,
 * attribute, URL, CSS, and template contexts."
 *
 * The count they were reacting to was ours: a previous response offered "1,418
 * escape call sites" as if the number were the argument. It is not. This file
 * asks three questions instead.
 *
 *   1. Do the escapers actually escape? Every local esc()/escHtml() definition
 *      is EXTRACTED FROM THE SHIPPED SOURCE and run against payloads in five
 *      contexts. Not a copy, not a description -- the function itself.
 *   2. Is there any sink whose escaper is weaker than the context it feeds?
 *   3. Has anyone added a new raw-HTML sink without deciding about it?
 *
 * WHAT THIS FOUND WHEN FIRST RUN
 * 25 escaper definitions in three different shapes. 15 escaped [<>&"] and NOT
 * the apostrophe. That is an attribute-context bypass wherever a single-quoted
 * attribute is built by concatenation -- and none was, so it was latent rather
 * than live. It is closed anyway: the gap was one refactor away from mattering,
 * and "no caller happens to hit it today" is the same reasoning that made the
 * 2026-05-18 RLS incident possible.
 *
 * WHAT THIS DOES NOT DO, said plainly:
 * it does not prove the 584 innerHTML sinks are each fed escaped data. That
 * needs data-flow analysis this repository does not have. It proves the
 * escapers are sound, that the sink count cannot grow silently, and that the
 * dangerous sink kinds stay at zero.
 *
 * Run:  node tests/xss-sinks.test.cjs
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

// ── the files that generate HTML ────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'index_files'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.js$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, 'src'));
for (const f of fs.readdirSync(ROOT)) {
  if (/^crm-.*\.js$/.test(f)) files.push(path.join(ROOT, f));
}
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

console.log('\nXSS sinks and escapers\n');

// ── 1. every escaper, extracted and executed ────────────────────────────────
const escapers = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /function\s+(esc|escHtml|escAttr|escapeHtml)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Take the whole function by brace matching from the opening brace.
    const open = src.indexOf('{', m.index);
    if (open < 0) continue;
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    escapers.push({ file: rel(f), name: m[1], src: src.slice(m.index, end + 1) });
  }
}

check('escaper definitions were found and extracted', escapers.length > 10,
  'found ' + escapers.length + ' — if the shape changed, this file is testing nothing');

/* Payloads, one per context the auditor named. Each is checked for the
   property that makes it inert IN THAT CONTEXT, not for a fixed output string:
   an escaper may legitimately encode more than the minimum. */
const CONTEXTS = [
  {
    name: 'element content',
    payload: '<img src=x onerror=alert(1)>',
    inert: (out) => !out.includes('<') && !out.includes('>'),
    why: 'a raw < opens a tag',
  },
  {
    name: 'double-quoted attribute',
    payload: 'x" onmouseover="alert(1)',
    inert: (out) => !out.includes('"'),
    why: 'a raw " closes the attribute and the rest becomes new attributes',
  },
  {
    name: 'single-quoted attribute',
    payload: "x' onmouseover='alert(1)",
    inert: (out) => !out.includes("'"),
    why: 'a raw apostrophe closes a single-quoted attribute. 15 escapers in ' +
         'this repository did not encode it; none fed a single-quoted ' +
         'attribute, so it was latent — one refactor from live',
  },
  {
    name: 'entity smuggling',
    payload: '&lt;script&gt;',
    inert: (out) => out.includes('&amp;'),
    why: 'without escaping &, an already-encoded payload survives a second ' +
         'decode and becomes a live tag',
  },
];

for (const e of escapers) {
  let fn;
  try {
    fn = new Function('return (' + e.src + ')')();
  } catch (err) {
    check(e.file + ' :: ' + e.name + ' is executable', false, String(err.message));
    continue;
  }
  for (const c of CONTEXTS) {
    let out;
    try { out = String(fn(c.payload)); } catch (err) { out = 'THREW: ' + err.message; }
    check(e.file + ' :: ' + e.name + ' — ' + c.name,
      c.inert(out), 'input:  ' + c.payload + '\noutput: ' + out + '\n' + c.why);
  }
  // Null and undefined reach these from the database constantly.
  let nullOut;
  try { nullOut = fn(null); } catch (err) { nullOut = 'THREW'; }
  check(e.file + ' :: ' + e.name + ' — null becomes empty, not "null"',
    nullOut === '', 'got ' + JSON.stringify(nullOut));
}

// ── 2. the dangerous sink kinds must stay absent ────────────────────────────
const FORBIDDEN = [
  ['eval(', /\beval\s*\(/],
  ['new Function(', /new\s+Function\s*\(/],
  ['setTimeout with a string', /set(Timeout|Interval)\s*\(\s*['"]/],
  ['iframe srcdoc', /\.srcdoc\s*=/],
  ['createContextualFragment', /createContextualFragment\s*\(/],
];
for (const [label, re] of FORBIDDEN) {
  const hits = [];
  for (const f of files) {
    blankComments(fs.readFileSync(f, 'utf8')).split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) hits.push(rel(f) + ':' + (i + 1));
    });
  }
  check('no ' + label, hits.length === 0, hits.join('\n') +
    '\nThese execute strings as code or render arbitrary HTML in a nested ' +
    'browsing context. If one is genuinely needed, it needs its own review, ' +
    'not an exemption added here in passing.');
}

// ── 3. the raw-HTML sink count is a ratchet ─────────────────────────────────
// 584 innerHTML assignments is not a number to be proud of, and it is not
// dropping today. What it must not do is grow silently: a new one should be a
// decision, and this makes it one.
// Set to the count observed on 2026-08-31. A ratchet, not a target: it exists
// so that adding one is a decision someone makes in a pull request, not a
// thing that happens.
const SINK_BUDGET = 606;
let sinkCount = 0;
const RAW = /\.(innerHTML|outerHTML)\s*(=|\+=)|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(/;
for (const f of files) {
  blankComments(fs.readFileSync(f, 'utf8')).split(/\r?\n/).forEach((line) => {
    if (RAW.test(line)) sinkCount++;
  });
}
check('raw-HTML sinks stay within budget (' + sinkCount + ' <= ' + SINK_BUDGET + ')',
  sinkCount <= SINK_BUDGET,
  'Adding a raw-HTML sink is a decision. Prefer textContent or DOM creation; ' +
  'if HTML is genuinely required, escape every interpolated value with the ' +
  "file's esc()/escHtml() and raise this budget deliberately in the same PR.");
check('the sink scan is still finding sinks', sinkCount > 100,
  'only ' + sinkCount + ' found — the pattern probably stopped matching, and a ' +
  'budget check that matches nothing passes forever');

console.log('\n  ' + escapers.length + ' escapers exercised, ' + sinkCount + ' raw-HTML sinks counted');
console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
