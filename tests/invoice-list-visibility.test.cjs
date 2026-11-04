// An invoice must never disappear from the Invoices page without the page
// saying so. Runs the real helpers from crm-index-core.js.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'crm-index-core.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; ; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(['glInvSearchKey', 'glInvMatchesSearch', 'glInvNumber', 'glSortInvoices'].map(grab).join('\n'), ctx);
const inv = { id: 'GL-1045', clientName: 'Ceres 14', svc: 'Rent NOV', amount: 5500, date: '2026-10-29' };
for (const q of ['GL-1045', 'gl1045', 'GL 1045', '1045', 'ceres', 'ceres14', 'rent', '5500']) assert(ctx.glInvMatchesSearch(inv, q), q);
assert(!ctx.glInvMatchesSearch(inv, 'GL-9999'));
const sorted = ctx.glSortInvoices([{ id: 'GL-1002', date: '' }, { id: 'GL-1047', date: '' }, { id: 'GL-1045', date: '' }]);
assert.deepStrictEqual(Array.from(sorted, (x) => x.id), ['GL-1047', 'GL-1045', 'GL-1002']);
assert(/effectiveInvoiceStatus\(i\)===invFilter/.test(src), 'status pills must use the status shown on screen');
assert(!/range\(0,499\)[\s\S]{0,200}iR\.data\.length>0\)\{\s*invoices\.length=0/.test(src), 'list must not be built from one capped page');
assert(/inv-hidden-notice/.test(src), 'hidden invoices must be announced');
console.log('invoice list visibility: all passed');
