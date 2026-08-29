/*
 * invoice-paid-writes.test.cjs — marking an invoice paid must not report
 * success when the database did not change.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four call sites flipped an invoice to 'paid' in memory, fired the paid
 * alert, and showed a success toast, behind an update with no .select() and no
 * rows-affected check. RLS rejects silently — 0 rows, no error — so a rejected
 * write looked exactly like a successful one until the next reload.
 * CLAUDE.md rule 4 attributes ~40 bugs to this pattern.
 *
 * There was also a second defect the audit did not catch: index.html declared
 * `async function quickPaid` TWICE at top level in the same <script> block.
 * The later declaration wins, so the live implementation was the shorter one,
 * which wrote only {status:'paid'} — never paid_at or paid_method, which
 * crm-accounting.js reads for AR aging — and matched on invoice_number only.
 * The fuller version above it was dead code.
 *
 * All four now route through glPersistInvoiceStatus. This file tests that
 * helper directly (it depends only on window.supa, so no browser is needed)
 * and asserts structurally that the call sites still use it.
 *
 * Run:  node tests/invoice-paid-writes.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The core script moved out of index.html into crm-index-core.js (GL-037).
// tests/_sources.cjs concatenates index.html with whatever the inline block
// has been extracted into, so these assertions keep meaning the same thing as
// GL-037 continues pulling capabilities out.
const { indexCore } = require('./_sources.cjs');
const INDEX = null;   // read through indexCore() below
const html = indexCore();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

/* Pull the helper's source straight out of the page so the test cannot drift
   from the shipped implementation. */
function extractHelper() {
  const start = html.indexOf('async function glPersistInvoiceStatus');
  if (start === -1) return null;
  let depth = 0, seen = false;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') { depth++; seen = true; }
    else if (html[i] === '}') { depth--; if (seen && depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}

/* Fake PostgREST builder. Records how the row was addressed so we can assert
   the supaId / invoice_number routing, and returns whatever `mode` dictates. */
function makeSupa(mode, calls) {
  return {
    from(table) {
      const q = {
        update(patch) { calls.push({ table, patch }); return q; },
        eq(col, val) { calls[calls.length - 1].by = col + '=' + val; return q; },
        select(cols) {
          calls[calls.length - 1].selected = cols || '*';
          if (mode === 'error') return Promise.resolve({ data: null, error: { message: 'permission denied' } });
          if (mode === 'norows') return Promise.resolve({ data: [], error: null });
          if (mode === 'throw') return Promise.reject(new Error('network down'));
          return Promise.resolve({ data: [{ invoice_number: 'GL-1042' }], error: null });
        },
      };
      return q;
    },
  };
}

async function callHelper(src, mode, inv) {
  const calls = [];
  const sandbox = { window: { supa: makeSupa(mode, calls) }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + '\n; globalThis.__fn = glPersistInvoiceStatus;', sandbox);
  const res = await sandbox.__fn(inv, { status: 'paid', paid_at: 'NOW', paid_method: 'manual' });
  return { res, calls };
}

(async () => {
  console.log('invoice mark-paid — a rejected write must not report success\n');

  // ── the call sites ───────────────────────────────────────────────────
  // Structural checks run FIRST and unconditionally. Against the pre-fix page
  // the helper does not exist, and bailing there would report one failure and
  // hide the four real ones. A regression signal is only useful if it names
  // what regressed.
  const quickPaidCount = (html.match(/^async function quickPaid/gm) || []).length;
  check('exactly one quickPaid declaration (a second one shadows the first)',
    quickPaidCount === 1, 'found ' + quickPaidCount);

  const rawUpdates = (html.match(/from\('invoices'\)\.update/g) || []).length;
  check('only the helper writes invoice status directly', rawUpdates === 1,
    'found ' + rawUpdates + " occurrences of from('invoices').update — expected 1 (inside the helper)");

  for (const fn of ['bulkMarkPaid', 'quickPaid', 'markStatus']) {
    const at = html.indexOf('async function ' + fn);
    check(fn + ' routes through glPersistInvoiceStatus',
      at !== -1 && /glPersistInvoiceStatus/.test(html.slice(at, at + 1800)));
  }

  check('paid_method is set on the mark-paid path (crm-accounting reads paid_at)',
    /paid_method:\s*'manual'/.test(html));

  // ── the helper's contract ────────────────────────────────────────────
  console.log('');
  const src = extractHelper();
  check('glPersistInvoiceStatus found in index.html', !!src);
  if (!src) {
    console.log('\n' + failures + ' CHECK(S) FAILED');
    process.exit(1);
  }

  let r = await callHelper(src, 'ok', { id: 'GL-1042', supaId: 'uuid-1' });
  check('success -> ok:true', r.res.ok === true, JSON.stringify(r.res));
  check('success -> addressed the row by supaId when present',
    r.calls[0].by === 'id=uuid-1', JSON.stringify(r.calls[0]));
  check('the write asks for rows back (.select)', !!r.calls[0].selected,
    'no .select() recorded — a silent RLS rejection would be invisible');

  r = await callHelper(src, 'ok', { id: 'GL-1042' });
  check('success -> falls back to invoice_number when there is no supaId',
    r.calls[0].by === 'invoice_number=GL-1042', JSON.stringify(r.calls[0]));

  r = await callHelper(src, 'norows', { id: 'GL-1042', supaId: 'uuid-1' });
  check('0 rows returned -> ok:false (the silent RLS rejection)', r.res.ok === false, JSON.stringify(r.res));
  check('0 rows returned -> reason mentions it was rejected',
    /0 rows|rejected/i.test(r.res.reason || ''), JSON.stringify(r.res));

  r = await callHelper(src, 'error', { id: 'GL-1042', supaId: 'uuid-1' });
  check('database error -> ok:false', r.res.ok === false);
  check('database error -> reason carries the message',
    /permission denied/i.test(r.res.reason || ''), JSON.stringify(r.res));

  r = await callHelper(src, 'throw', { id: 'GL-1042', supaId: 'uuid-1' });
  check('thrown error -> ok:false rather than an unhandled rejection', r.res.ok === false, JSON.stringify(r.res));

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
