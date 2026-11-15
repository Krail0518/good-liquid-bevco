/*
 * wh-billing.test.mjs — the warehouse billing math the monthly auto-invoice
 * job runs (supabase/functions/_shared/wh-billing.mjs).
 *
 * The job must bill exactly what the Billing tab shows, so these pin the
 * page's rules: any part of a month counts as the month, a pull is billed in
 * the month it happened, Good Liquid's own packaging is never billed, days are
 * Florida days, and every value that reaches the email is escaped.
 *
 * Run: node tests/wh-billing.test.mjs
 */
import {
  billMonth, billLines, dueDate, emailHtml, monthLabel, nextInvoiceNumber, nyDay, previousMonth,
} from '../supabase/functions/_shared/wh-billing.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

const A = 'client-a', B = 'client-b';
const sku = (cid, name) => ({ client_id: cid, upc_sku: 'SKU', description: 'Cans', client: cid ? { name } : null });
const pallets = {
  p1: { pallet_tag: 'GL-P-000001', conri_pallet_id: '9601', sku: sku(A, 'Atlas') },  // all of October
  p2: { pallet_tag: 'GL-P-000002', conri_pallet_id: null, sku: sku(A, 'Atlas') },    // in Oct 31, 10pm ET
  p3: { pallet_tag: 'GL-P-000003', conri_pallet_id: null, sku: sku(A, 'Atlas') },    // pulled Oct 10
  p4: { pallet_tag: 'GL-P-000004', conri_pallet_id: null, sku: sku(B, 'Perico') },   // arrives Nov 2
  p5: { pallet_tag: 'GL-P-000005', conri_pallet_id: null, sku: sku(null) },          // our packaging
  p6: { pallet_tag: 'GL-P-000006', conri_pallet_id: null, sku: sku(B, 'Perico') },   // pulled Sep 30
};
const mv = (seq, pid, from, to, at, transfer) => ({ seq, pallet_id: pid, from_location: from, to_location: to, at, transfer: transfer || null });
const moves = [
  mv(1, 'p1', 'good_liquid', 'conri', '2026-09-20T15:00:00Z'),
  mv(2, 'p2', 'good_liquid', 'conri', '2026-11-01T02:00:00Z'),          // = Oct 31 22:00 ET
  mv(3, 'p3', 'good_liquid', 'conri', '2026-09-01T15:00:00Z'),
  mv(4, 'p3', 'conri', 'shipped', '2026-10-12T15:00:00Z', { type: 'outbound', transfer_number: 'GL-TR-1', scheduled_at: '2026-10-10T14:00:00Z', completed_at: '2026-10-12T15:00:00Z' }),
  mv(5, 'p4', 'good_liquid', 'conri', '2026-11-02T15:00:00Z'),
  mv(6, 'p5', 'good_liquid', 'conri', '2026-09-01T15:00:00Z'),
  mv(7, 'p6', 'good_liquid', 'conri', '2026-09-01T15:00:00Z'),
  mv(8, 'p6', 'conri', 'good_liquid', '2026-10-01T03:00:00Z'),          // = Sep 30 23:00 ET
];
const rates = (cid) => (cid === B ? { storage: 25, pull: 10 } : { storage: 30, pull: 15 });
const oct = billMonth(moves, pallets, '2026-10', rates);
const atlas = oct.find((o) => o.client_id === A);
const own = oct.find((o) => !o.billable);

console.log('billMonth\n');
check('Atlas: 3 pallets stored in October (any part of the month counts)', atlas && atlas.stored.length === 3, JSON.stringify(atlas && atlas.stored.map((x) => x.pallet_tag)));
check('a pallet arriving 10pm ET on Oct 31 is October, not November (Florida days)', atlas.stored.some((x) => x.pallet_tag === 'GL-P-000002'));
check('a pull is dated by its appointment when that came first', atlas.pulls.length === 1 && atlas.pulls[0].day === '2026-10-10', JSON.stringify(atlas.pulls));
check('Atlas total = 3 × $30 + 1 × $15 = $105', atlas.total === 105, String(atlas.total));
check('Perico: pulled 11pm ET Sep 30 and next pallet arrives Nov 2 → nothing in October', !oct.find((o) => o.client_id === B));
check('Good Liquid packaging listed but not billable, at $0', own && own.billable === false && own.total === 0);
check('billable owners sort first', oct[0].billable === true);
const nov = billMonth(moves, pallets, '2026-11', rates);
check('client rate override applies (Perico Nov: 1 × $25)', nov.find((o) => o.client_id === B).total === 25);

console.log('\nbillLines / invoice fields\n');
const lines = billLines(atlas, '2026-10');
check('two lines: storage then pulls', lines.length === 2 && /^Warehouse storage, October 2026: 3 pallets/.test(lines[0].desc) && /^Pallet pulls, October 2026: 1 pallet \(/.test(lines[1].desc), JSON.stringify(lines));
check('CONRI number preferred over our tag in the line', lines[0].desc.includes('CONRI #9601'));
check('line totals match the bill', lines[0].total === 90 && lines[1].total === 15);
check('same description format as the manual invoices (dedupe relies on it)',
  /^(Warehouse storage|Pallet pulls), October 2026:/.test(lines[0].desc));
check('Due on receipt → due today', dueDate('Due on receipt', '2026-12-01') === '2026-12-01');
check('Net 30 → 30 days later, across a month end', dueDate('Net 30', '2026-12-01') === '2026-12-31');
check('next invoice number is one above the highest', nextInvoiceNumber(['GL-20261110', 'GL-20261112', 'GL-1004', null]) === 'GL-20261113');
check('monthLabel', monthLabel('2026-10') === 'October 2026');

console.log('\nperiod (Florida time)\n');
check('Dec 1, 9am ET bills November', previousMonth(new Date('2026-12-01T14:00:00Z')) === '2026-11');
check('Jan 1 bills December of the year before', previousMonth(new Date('2027-01-01T14:00:00Z')) === '2026-12');
check('11pm ET on Nov 30 is still November in Florida', nyDay('2026-12-01T04:00:00Z') === '2026-11-30');

console.log('\nemail escaping\n');
const evil = { name: '<img src=x onerror=alert(1)>', legal_name: '', contact_name: '"><script>x</script>', email: 'a@b.c', street: '<b>1</b>' };
const html = emailHtml({ invoice_number: 'GL-1', amount: 1, status: 'pending', invoice_date: '2026-12-01', due_date: '2026-12-01', payment_terms: 'Due on receipt',
  line_items: [{ desc: '<script>alert(1)</script>', qty: 1, unitPrice: 1, unit: 'pallet', total: 1 }] }, evil, '2026-11', 'https://x/?invoice_view="onmouseover=1');
check('no raw tags from client data or line descriptions', !/<script|<img|<b>1/.test(html));
check('pay link attribute cannot be broken out of', !html.includes('"onmouseover'));

console.log('\nwiring\n');
const fn = fs.readFileSync(new URL('../supabase/functions/wh-monthly-billing/index.ts', import.meta.url), 'utf8');
check('real runs need admin; previews and dry runs need staff', /requireStaff\(req, \{ role: dryRun \|\| previewTo \? 'staff' : 'admin' \}\)/.test(fn));
check('skips a month already marked billed', /wh_billing_statements'\)\.select\('invoice_ref,amount'\)/.test(fn));
check('skips a client with a hand-made storage invoice for the month', /existingInvoice\(db, o\.client_id, ym\)/.test(fn));
check('refuses to bill a month that is not over', /is not over yet/.test(fn));
check('checks every write returned a row (RLS-style silent failures)', /ins\.data\.length === 1/.test(fn) && /stmt\.data\.length/.test(fn));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
