#!/usr/bin/env node
/* Fixtures for the shared JavaScript walker.
 *
 * Every case here is a mistake a previous scanner in this repository actually
 * made. A guard that mis-parses does not fail loudly — it blesses whatever it
 * could not see — so the walker itself needs ground truth.
 *
 * Run:  node tests/_jsscan.test.cjs
 */
const { blankComments, findInStrings, lineAt } = require('./_jsscan.cjs');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + String(detail).split('\n').join('\n        '));
}

console.log('\nJavaScript walker — strings, comments, templates, regexes\n');

// ── blankComments ───────────────────────────────────────────────────────────
const CASES = [
  {
    name: 'a line comment is blanked',
    src: "var a = 1; // .update() here\nvar b = 2;",
    gone: '.update(',
  },
  {
    name: 'a block comment is blanked',
    src: "/* Persists via supa.from('deals').update(...) */\nvar x = 1;",
    gone: '.update(',
  },
  {
    // The bug that produced this file: /"/ is a regex, and a scanner that reads
    // its " as opening a string then treats the rest of the file as string
    // content and stops stripping comments entirely.
    name: 'a regex containing a quote does not desync the walker',
    src: "s.replace(/\"/g, '&quot;');\n// .update() in a comment\nvar y = 2;",
    gone: '.update(',
  },
  {
    name: "a regex containing an apostrophe does not desync it either",
    src: "s.replace(/'/g, '');\n// .delete() in a comment\nvar y = 2;",
    gone: '.delete(',
  },
  {
    // An accept="/*,.pdf" attribute once opened a phantom block comment and
    // blinded a different scan for 519 lines.
    name: 'a /* inside a string does not open a comment',
    src: "var h = '<input accept=\"/*,.pdf\">';\nvar keep = 1; // gone\nvar after = '.update(';",
    gone: '// gone',
    kept: ".update(",
  },
  {
    name: 'code is never blanked',
    src: "await sb.from('x').update({a:1});",
    kept: '.update(',
  },
  {
    name: 'a template literal survives intact',
    src: 'var t = `a\nb .update( c`;',
    kept: '.update(',
  },
];

for (const c of CASES) {
  const out = blankComments(c.src);
  let ok = true;
  let why = '';
  if (c.gone && out.includes(c.gone)) { ok = false; why = 'still present: ' + c.gone; }
  if (c.kept && !out.includes(c.kept)) { ok = false; why = 'wrongly removed: ' + c.kept; }
  check(c.name, ok, why + '\ngot: ' + JSON.stringify(out));
}

check('blanking preserves length exactly',
  CASES.every((c) => blankComments(c.src).length === c.src.length),
  'offsets and line numbers depend on it');
check('blanking preserves line count exactly',
  CASES.every((c) => blankComments(c.src).split('\n').length === c.src.split('\n').length));

// ── findInStrings ───────────────────────────────────────────────────────────
const TPL = [
  'var html = `',
  '  <div>',
  '    <style>a{}</style>',
  '  </div>`;',
].join('\n');
const hits = findInStrings(TPL, '<style');
check('<style> inside a multi-line template is found', hits.length === 1,
  'the backtick is three lines above it — a line regex misses this, which is ' +
  'how a scanner reported 10 sites where there were 11');
check('and its line number is right', hits.length === 1 && lineAt(TPL, hits[0]) === 3,
  'got line ' + (hits.length ? lineAt(TPL, hits[0]) : 'none') +
  '. Counting lines during the walk gets this wrong, because escape and regex ' +
  'skips jump over newlines — that reported one site 96 lines from where it lives.');

const NOT_IN_STRING = 'if (a < style) { b(); }';
check('a bare < style in code is not reported',
  findInStrings(NOT_IN_STRING, '<style').length === 0);

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
