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
 * src/modules/invoicing/accounting.js reads for AR aging — and matched on invoice_number only.
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

  // Only STATUS writes must go through the helper. This used to count every
  // from('invoices').update, which over-matched the moment GL-037 moved a file
  // holding an unrelated invoice write into src/ — help-features.js sets
  // waive_card_surcharge, and does it correctly, with .select() and a 0-row
  // check. Failing on that would have taught the next person to relax the
  // check rather than read it.
  //
  // The rule is about the columns that decide whether an invoice is paid.
  // Stated as the rule actually is: no call site outside the helper may write
  // a status-bearing payload. The helper itself passes a variable
  // (`update(patch)`), so it carries no column names to match — asserting a
  // count of literal matches would have required it to be 1 and found 0.
  // GL-020 was never about centralising the write. It was about writes that
  // report success on rows the database refused: RLS rejects by returning zero
  // rows and no error.
  //
  // An earlier version of this check demanded that ONLY glPersistInvoiceStatus
  // write status. That held while the only writers lived in index.html, and
  // broke the moment GL-037 moved accounting.js and billing-admin.js into
  // src/. Those three writes — void, record-payment, quote auto-expiry — are
  // long-standing, and every one already checks its result properly. The rule
  // was wrong, not the code.
  //
  // So assert the property that actually matters: every status-bearing write
  // asks for rows back and inspects what came back.
  const STATUS_COLS = /\b(status|paid_at|paid_method|paid_amount)\s*:/;
  const statusWrites = [...html.matchAll(/from\('invoices'\)\.update\(\s*\{([^}]*)\}/g)]
    .filter((m) => STATUS_COLS.test(m[1]));

  const unchecked = statusWrites.filter((m) => {
    const after = html.slice(m.index, m.index + 700);
    const asksForRows = /\.select\(/.test(after);
    // Either an explicit rows-affected test, or reading .data.length before
    // acting on it. Checking `error` alone is NOT enough — that is precisely
    // the bug: a refusal arrives as zero rows with no error.
    // Accept every form the codebase actually uses to read the row count:
    //
    //   rows.length === 0                 explicit comparison
    //   !r.data || !r.data.length         negation (crm-extras uses this)
    //   r.data && r.data.length           truthiness before acting
    //
    // The first version of this check only recognised `=== 0`, and flagged two
    // correctly-guarded writes in crm-extras.js as unchecked. A false positive
    // here is expensive: it argues for relaxing a rule that exists because ~40
    // real bugs came from unchecked writes.
    const readsRowCount = /\.length\s*===\s*0/.test(after)
      || /\.data\.length/.test(after)
      || /\.data\s*&&\s*\w+\.data\.length/.test(after);
    return !(asksForRows && readsRowCount);
  });

  check('every invoice status write checks rows-affected, not just error',
    unchecked.length === 0,
    'found ' + unchecked.length + ' unchecked status write(s): ' +
    unchecked.map((m) => '{' + m[1].trim().slice(0, 70) + '}').join(' | ') +
    ' — RLS refuses with zero rows and NO error, so an error-only check ' +
    'reports success on a write that never happened');

  check('there is at least one status write to check',
    statusWrites.length > 0,
    'the pattern stopped matching — this rule is now asserting nothing');

  check('the helper itself performs the invoice update',
    /glPersistInvoiceStatus[\s\S]{0,900}?from\('invoices'\)\.update\(patch\)/.test(html),
    'the single permitted write lives inside the helper; if it moved, this ' +
    'rule has nothing left to protect');

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

  // ── effectiveInvoiceStatus: an invoice due TODAY is not late yet ────
  //
  // The old comparison was `new Date(inv.dueDate) < new Date()`. A date-only
  // string parses as UTC midnight while the right side is a moment, so an
  // invoice due today read as overdue from 8pm the previous evening in Florida
  // (UTC-4) — customers shown as late a day early, and the A/R tallies
  // inherited it. The nightly mark-overdue-invoices job uses
  // `due_date < current_date`; these assertions pin the client to that rule.
  // indexCore() already returns index.html plus every core script joined
  // together — the same text the rest of this file reads.
  const effSrc = html;
  const effMatch = /function effectiveInvoiceStatus\(inv\)\{[\s\S]*?\n\}/.exec(effSrc);
  check('effectiveInvoiceStatus is still findable',
    !!effMatch,
    'without it the assertions below would silently test nothing');

  if (effMatch) {
    const effectiveInvoiceStatus = new Function('return (' + effMatch[0] + ')')();
    const iso = (offsetDays) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return d.getFullYear() + '-' +
             String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0');
    };
    const status = (offsetDays, s) =>
      effectiveInvoiceStatus({ status: s || 'pending', dueDate: iso(offsetDays) });

    check('an invoice due TODAY is still pending, not overdue',
      status(0) === 'pending',
      'got "' + status(0) + '" — due today is not late yet, and this is the ' +
      'exact case that reported customers as late a day early');

    check('an invoice due TOMORROW is still pending',
      status(1) === 'pending', 'got "' + status(1) + '"');

    check('an invoice due YESTERDAY is overdue',
      status(-1) === 'overdue', 'got "' + status(-1) + '"');

    check('a paid invoice is never reported overdue, whatever its due date',
      status(-30, 'paid') === 'paid', 'got "' + status(-30, 'paid') + '"');

    check('a missing or malformed due date does not become overdue',
      effectiveInvoiceStatus({ status: 'pending', dueDate: null }) === 'pending' &&
      effectiveInvoiceStatus({ status: 'pending', dueDate: 'not-a-date' }) === 'pending',
      'an unparseable date must not silently mark someone late');
  }

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
