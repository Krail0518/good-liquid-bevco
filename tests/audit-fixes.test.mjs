/*
 * audit-fixes.test.mjs — five bugs found in the Nov 2026 Help audit.
 *
 * 1. The emailed project questionnaire said the minimum was 200 cases; the
 *    canning minimum has been 300 since #524.
 * 2. A saved intake answer that is no longer one of a dropdown's options
 *    (44 clients answered "200 to 499 cases") rendered blank, so saving the
 *    form erased it. It is now kept as its own "(earlier answer)" option.
 * 3-5. Static checks that the deal edit form keeps unlisted values, the
 *    website calculator prices pasteurization by can size, the quote builder
 *    warns below the canning minimum, and the client record shows the terms
 *    agreement. (Behaviour was checked in the real page when they shipped.)
 *
 * Run: node tests/audit-fixes.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1. Emailed questionnaire minimum ────────────────────────────────────────
const deck = await import(new URL('file:///' + path.join(ROOT, 'supabase/functions/_shared/sales-deck.mjs').replace(/\\/g, '/')).href);
const items = deck.QUESTIONNAIRE_ITEMS.join('\n');
check('questionnaire run-size question starts at 300 cases', /300 to 499 cases/.test(items) && !/200 to 499/.test(items), items.match(/First run size[^\n]*/));
const email = deck.questionnaireEmail({ id: 'd1', email: 'lead@example.com', co: 'Example Co', contactName: 'Pat Lee', name: 'Example Co — Quote Request' }, {});
const emailText = JSON.stringify(email);
check('questionnaire email states the 300 case (7,200 can) minimum', /300 cases \(7,200 cans\)/.test(emailText));
check('questionnaire email no longer mentions a 200 case minimum', !/200 cases/.test(emailText));

// ── 2. Unlisted saved answers are kept, and escaped ─────────────────────────
const host = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
const window = {};
const document = { getElementById: () => host, querySelector: () => host, createElement: () => ({ style: {} }) };
vm.runInNewContext(read('intake-questions.js'), { window, document, console });
const GL = window.GL_INTAKE;
check('intake module loads', GL && typeof GL.render === 'function');
GL.render(host, { target_volume: '200 to 499 cases', format: '<img src=x onerror=alert(1)>' });
const html = host.innerHTML;
check('an old "200 to 499 cases" answer is kept and selected',
  /<option value="200 to 499 cases" selected>200 to 499 cases \(earlier answer\)<\/option>/.test(html), (html.match(/<select id="gi-target_volume"[\s\S]*?<\/select>/) || [''])[0].slice(0, 300));
check('the listed options are still offered', /<option>300 to 499 cases<\/option>/.test(html));
check('a kept answer is escaped', html.indexOf('<img src=x') === -1 && html.indexOf('&lt;img src=x onerror=alert(1)&gt;') > -1);
GL.render(host, { target_volume: '500 to 999 cases' });
check('a listed answer is not duplicated', !/earlier answer/.test(host.innerHTML) && /<option selected>500 to 999 cases<\/option>/.test(host.innerHTML));

// ── 3-5. Static guards ──────────────────────────────────────────────────────
const dd = read('src/modules/pipeline/deal-detail.js');
check('deal edit form keeps a value its dropdown does not list', /data-gl-kept/.test(dd) && /tagName === 'SELECT'/.test(dd));
const tools = read('src/shared/tools.js');
check('calculator pasteurization is 3¢ for 12 oz and 5¢ for 16 oz', /\/\^16\/\.test\(fmt\.value\) \? 0\.05 : 0\.03/.test(tools) && /units \* pRate/.test(tools));
check('calculator no longer charges a flat 5¢ per can', !/isBtl \? 0\.20 : 0\.05\) : 0/.test(tools));
const qb = read('src/modules/quotes/quote-builder.js');
check('quote builder warns below the 300 case canning minimum', /CAN_MIN_CASES = 300/.test(qb) && /isBottling \|\| isCanning/.test(qb));
const ob = read('src/modules/customers/onboarding.js');
check('client record shows the terms agreement', /terms:data->terms_acceptance/.test(ob) && /Terms agreed/.test(ob) && /No terms agreement on file/.test(ob));

console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
