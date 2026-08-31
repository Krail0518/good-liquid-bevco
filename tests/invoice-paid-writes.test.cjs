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
    /* Paid state stopped being an UPDATE. It is derived from the payment
       ledger inside a locked transaction, and a database trigger refuses any
       direct write to it — so the helper now calls an RPC and has to read the
       VERDICT the RPC returns, not just `error`. That is the same defect in a
       new shape: {applied:false} with no error is this design's version of
       "zero rows, no error", and it must not report success. */
    rpc(name, args) {
      calls.push({ rpc: name, args });
      if (mode === 'error') return Promise.resolve({ data: null, error: { message: 'permission denied' } });
      if (mode === 'throw') return Promise.reject(new Error('network down'));
      if (mode === 'declined') return Promise.resolve({ data: { applied: false, reason: 'unknown_invoice' }, error: null });
      if (name === 'gl_reverse_invoice_payments') {
        return Promise.resolve({ data: { applied: true, reason: 'reversed', status: 'pending' }, error: null });
      }
      return Promise.resolve({ data: { applied: true, reason: 'applied', status: 'paid', paid_total: 1042 }, error: null });
    },
  };
}

async function callHelper(src, mode, inv, patch) {
  const calls = [];
  const sandbox = { window: { supa: makeSupa(mode, calls) }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + '\n; globalThis.__fn = glPersistInvoiceStatus;', sandbox);
  const res = await sandbox.__fn(inv, patch || { status: 'paid', paid_at: 'NOW', paid_method: 'manual' });
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

  // This used to assert that the helper performed the invoice UPDATE itself.
  // It no longer does one for paid state, and must not: a database trigger now
  // refuses any direct write to status='paid', paid_at, paid_amount,
  // paid_method or stripe_session_id, so that UPDATE would be rejected with
  // 42501. Paid state is derived from the payment ledger. The rule this check
  // exists to protect — that the single mark-paid route lives in one place —
  // is unchanged; only the mechanism moved.
  const helperSrc = html.slice(html.indexOf('async function glPersistInvoiceStatus'));
  check('the helper routes marking paid through the ledger RPC',
    /gl_record_manual_payment/.test(helperSrc.slice(0, 2500)),
    'marking paid must go through gl_record_manual_payment; a direct UPDATE ' +
    'is refused by the database with 42501');
  check('the helper routes marking unpaid through the reversal RPC',
    /gl_reverse_invoice_payments/.test(helperSrc.slice(0, 2500)),
    'clearing paid state must be a reversing ledger event, not a column write');
  check('the helper still performs a plain update for non-paid statuses',
    /from\('invoices'\)\.update\(patch\)/.test(helperSrc.slice(0, 2500)),
    'draft/sent/pending/overdue/void assert nothing about money and must ' +
    'still be ordinary writes — with .select() and a rows-affected check');

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

  const PAID = { status: 'paid', paid_at: 'NOW', paid_method: 'manual' };
  const UNPAID = { status: 'pending', paid_at: null, paid_amount: null, paid_method: null };
  const SENT = { status: 'sent' };

  // ── marking paid: a ledger event, and its verdict must be read ──────
  let r = await callHelper(src, 'ok', { id: 'GL-1042', supaId: 'uuid-1' }, PAID);
  check('mark paid -> ok:true', r.res.ok === true, JSON.stringify(r.res));
  check('mark paid -> calls gl_record_manual_payment',
    r.calls[0] && r.calls[0].rpc === 'gl_record_manual_payment', JSON.stringify(r.calls[0]));
  check('mark paid -> names the invoice by its number',
    r.calls[0] && r.calls[0].args && r.calls[0].args.p_invoice_number === 'GL-1042',
    JSON.stringify(r.calls[0]));
  check('mark paid -> sends no amount, meaning "settle the balance"',
    r.calls[0] && r.calls[0].args && r.calls[0].args.p_amount === null,
    'a hard-coded amount here would silently under- or over-pay a partially ' +
    'paid invoice');

  // This is the new shape of the old bug. {applied:false} arrives with NO
  // error, exactly as an RLS refusal arrives as zero rows with no error.
  r = await callHelper(src, 'declined', { id: 'GL-1042', supaId: 'uuid-1' }, PAID);
  check('a declined verdict -> ok:false, not silent success',
    r.res.ok === false, JSON.stringify(r.res));
  check('a declined verdict -> reason names why the server refused',
    /unknown_invoice/i.test(r.res.reason || ''), JSON.stringify(r.res));

  r = await callHelper(src, 'error', { id: 'GL-1042', supaId: 'uuid-1' }, PAID);
  check('mark paid, database error -> ok:false', r.res.ok === false);
  check('mark paid, database error -> reason carries the message',
    /permission denied/i.test(r.res.reason || ''), JSON.stringify(r.res));

  r = await callHelper(src, 'throw', { id: 'GL-1042', supaId: 'uuid-1' }, PAID);
  check('mark paid, thrown error -> ok:false rather than an unhandled rejection',
    r.res.ok === false, JSON.stringify(r.res));

  // ── marking unpaid: a reversing event ───────────────────────────────
  r = await callHelper(src, 'ok', { id: 'GL-1042', supaId: 'uuid-1' }, UNPAID);
  check('mark unpaid -> calls gl_reverse_invoice_payments',
    r.calls[0] && r.calls[0].rpc === 'gl_reverse_invoice_payments', JSON.stringify(r.calls[0]));
  check('mark unpaid -> ok:true', r.res.ok === true, JSON.stringify(r.res));

  r = await callHelper(src, 'declined', { id: 'GL-1042', supaId: 'uuid-1' }, UNPAID);
  check('mark unpaid, declined verdict -> ok:false', r.res.ok === false, JSON.stringify(r.res));

  // ── every other status: still an ordinary, checked write ────────────
  r = await callHelper(src, 'ok', { id: 'GL-1042', supaId: 'uuid-1' }, SENT);
  check('a non-paid status is an ordinary update, not an RPC',
    r.calls[0] && r.calls[0].table === 'invoices' && !r.calls[0].rpc, JSON.stringify(r.calls[0]));
  check('a non-paid status write addresses the row by supaId when present',
    r.calls[0].by === 'id=uuid-1', JSON.stringify(r.calls[0]));
  check('a non-paid status write asks for rows back (.select)', !!r.calls[0].selected,
    'no .select() recorded — a silent RLS rejection would be invisible');

  r = await callHelper(src, 'ok', { id: 'GL-1042' }, SENT);
  check('a non-paid status write falls back to invoice_number when there is no supaId',
    r.calls[0].by === 'invoice_number=GL-1042', JSON.stringify(r.calls[0]));

  r = await callHelper(src, 'norows', { id: 'GL-1042', supaId: 'uuid-1' }, SENT);
  check('0 rows returned -> ok:false (the silent RLS rejection)', r.res.ok === false, JSON.stringify(r.res));
  check('0 rows returned -> reason mentions it was rejected',
    /0 rows|rejected/i.test(r.res.reason || ''), JSON.stringify(r.res));

  r = await callHelper(src, 'error', { id: 'GL-1042', supaId: 'uuid-1' }, SENT);
  check('database error -> ok:false', r.res.ok === false);

  r = await callHelper(src, 'throw', { id: 'GL-1042', supaId: 'uuid-1' }, SENT);
  check('thrown error -> ok:false rather than an unhandled rejection', r.res.ok === false, JSON.stringify(r.res));

  // ── effectiveInvoiceStatus: the overdue POLICY ──────────────────────
  //
  // The rule is the business's, not an inference: an unpaid invoice is shown
  // overdue only once it is more than GRACE days past due (21 by default), and
  // only while the flag is on. Both come from app_settings.
  //
  // This function has now been wrong twice, in opposite directions, which is
  // why each boundary below is pinned rather than spot-checked:
  //   the original compared a UTC-midnight date to a moment, so an invoice due
  //     TOMORROW went overdue at 8pm tonight;
  //   an intermediate version used `due < today`, reporting a genuinely late
  //     invoice as pending.
  const effSrc = html;
  const effMatch = /function effectiveInvoiceStatus\(inv\)\{[\s\S]*?\n\}/.exec(effSrc);
  check('effectiveInvoiceStatus is still findable',
    !!effMatch,
    'without it the assertions below would silently test nothing');

  if (effMatch) {
    // The function reads policy through window.glGetSetting; give it one.
    const makeStatus = (settings) => {
      const win = {
        glGetSetting: (k, d) => (k in settings ? settings[k] : d),
      };
      const fn = new Function('window', 'return (' + effMatch[0] + ')')(win);
      return fn;
    };
    const iso = (offsetDays) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return d.getFullYear() + '-' +
             String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0');
    };

    const dflt = makeStatus({});                       // defaults: on, 21 days
    const pending = (days) => dflt({ status: 'pending', dueDate: iso(days) });

    check('DEFAULT policy is three weeks: 21 days past due is NOT yet overdue',
      pending(-21) === 'pending',
      'got "' + pending(-21) + '" at exactly 21 days past due');

    check('22 days past due IS overdue',
      pending(-22) === 'overdue', 'got "' + pending(-22) + '"');

    check('an invoice due today is not overdue under a three-week grace',
      pending(0) === 'pending', 'got "' + pending(0) + '"');

    check('an invoice a week past due is not overdue yet',
      pending(-7) === 'pending', 'got "' + pending(-7) + '"');

    // The ORIGINAL timezone bug: a date-only string parsed as UTC midnight
    // against a moment, so this flipped at 8pm the previous evening.
    check('an invoice due TOMORROW is never overdue',
      pending(1) === 'pending', 'got "' + pending(1) + '"');

    check('the grace period is configurable, not hardcoded',
      makeStatus({ invoice_overdue_grace_days: 3 })({ status: 'pending', dueDate: iso(-5) }) === 'overdue' &&
      makeStatus({ invoice_overdue_grace_days: 90 })({ status: 'pending', dueDate: iso(-30) }) === 'pending',
      '3-day grace must flag a 5-day-old invoice; 90-day grace must not flag a 30-day-old one');

    check('turning the flag OFF suppresses overdue, including a stored one',
      makeStatus({ invoice_overdue_enabled: false })({ status: 'pending', dueDate: iso(-999) }) === 'pending' &&
      makeStatus({ invoice_overdue_enabled: false })({ status: 'overdue', dueDate: iso(-999) }) === 'pending',
      'switching it off must clear the flag everywhere, or the switch means nothing');

    check('a status already set to overdue is honoured, not recomputed',
      dflt({ status: 'overdue', dueDate: iso(0) }) === 'overdue',
      'GL-1024 is exactly this: stored overdue while 0 days past due. The grace ' +
      'period governs the automatic flip, not a decision somebody already made.');

    check('a paid invoice is never reported overdue, whatever its due date',
      dflt({ status: 'paid', dueDate: iso(-999) }) === 'paid');

    check('a missing or malformed due date does not become overdue',
      dflt({ status: 'pending', dueDate: null }) === 'pending' &&
      dflt({ status: 'pending', dueDate: 'not-a-date' }) === 'pending',
      'an unparseable date must not silently mark someone late');

    check('a nonsense grace value falls back to the documented 21 days',
      makeStatus({ invoice_overdue_grace_days: 'abc' })({ status: 'pending', dueDate: iso(-22) }) === 'overdue' &&
      makeStatus({ invoice_overdue_grace_days: -5 })({ status: 'pending', dueDate: iso(-1) }) === 'pending',
      'a bad setting must not turn into "everything is overdue"');
  }

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
