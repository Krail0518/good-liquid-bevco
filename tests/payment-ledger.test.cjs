#!/usr/bin/env node
/* Payment integrity — the invariants that must hold in the source.
 *
 * The external audit graded payment application CRITICAL and release-blocking:
 * invoice state had to change "only from server-derived, exact, idempotent
 * payment events inside a database transaction". None of that held. The Stripe
 * webhook PATCHed `invoices` with status='paid' on every delivery, and Stripe
 * redelivers an event for up to three days.
 *
 * What this file can and cannot prove:
 *   CAN  — that the migration defines the guard, the uniqueness that settles a
 *          race, and append-only enforcement; and that no code path writes paid
 *          state around them.
 *   CANNOT — that the database behaves as described. That needs a live database
 *          and is proved by scripts/payment-ledger-proof.sql, whose output is
 *          the evidence artifact. Both halves are required; neither substitutes
 *          for the other.
 *
 * Run:  node tests/payment-ledger.test.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20260831000000_payment_event_ledger.sql');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); return; }
  failures++;
  console.log('  FAIL  ' + name);
  if (detail) console.log('        ' + String(detail).split('\n').join('\n        '));
}

const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

console.log('\nPayment ledger — source invariants\n');

// ── 1. The migration exists and defines the four things the design rests on ──
const migrationExists = fs.existsSync(MIGRATION);
check('the payment ledger migration is present', migrationExists, MIGRATION);

const sql = migrationExists ? read(MIGRATION) : '';

check('a ROLLBACK note is present, as every migration in this repo requires',
  /^--\s*ROLLBACK:/m.test(sql));

check('idempotency: a unique index on (provider, provider_event_id)',
  /create unique index[\s\S]{0,200}invoice_payments\s*\(provider,\s*provider_event_id\)/i.test(sql),
  'Without this, two deliveries of one Stripe event both insert. It is the ' +
  'constraint that settles the race; the pre-flight SELECT only catches the ' +
  'slow retry.');

check('the ledger is append-only: a trigger refuses UPDATE and DELETE',
  /before update or delete on public\.invoice_payments/i.test(sql),
  'A ledger you can edit is not a ledger; corrections must be reversal rows.');

check('paid state is guarded: a trigger fires before update on invoices',
  /before update on public\.invoices[\s\S]{0,120}gl_guard_invoice_paid_state/i.test(sql));

check('the guard covers every column that asserts a payment',
  ['paid_at', 'paid_amount', 'paid_method', 'stripe_session_id']
    .every((c) => new RegExp('new\\.' + c + '\\s+is distinct from old\\.' + c).test(sql)),
  'Missing one of these leaves a column through which paid state can be ' +
  'forged without the ledger.');

check('the racing insert is caught and answered as a duplicate, not raised',
  /exception when unique_violation then[\s\S]{0,300}duplicate_event/i.test(sql),
  'A raise here becomes a 500, and Stripe retries an event that was in fact ' +
  'applied correctly.');

// ── 2. The privileged RPC is not reachable by a browser session ──────────────
for (const fn of ['gl_apply_payment_event', 'gl_apply_refund_event']) {
  const revoked = new RegExp('revoke all on function public\\.' + fn + '[^;]*from[^;]*anon[^;]*authenticated', 'i').test(sql)
               || new RegExp('revoke all on function public\\.' + fn + '[^;]*from public, anon, authenticated', 'i').test(sql);
  check(fn + ' is revoked from anon and authenticated', revoked,
    'Provider events must only be applicable by the service role. A browser ' +
    'able to call this could mark any invoice paid by inventing an event id.');
  check(fn + ' is granted to service_role',
    new RegExp('grant execute on function public\\.' + fn + '[^;]*to service_role', 'i').test(sql));
}

for (const fn of ['gl_record_manual_payment', 'gl_reverse_invoice_payments']) {
  check(fn + ' checks is_gl_staff() before doing anything',
    new RegExp('create or replace function public\\.' + fn + '[\\s\\S]{0,1400}?if not public\\.is_gl_staff\\(\\) then', 'i').test(sql),
    'Supabase signup is open. A self-registered stranger holds the ' +
    'authenticated role, so the grant alone is not an authorization check.');
}

// ── 3. No code writes paid state around the ledger ───────────────────────────
// The guard makes such a write fail at runtime with 42501; this catches it at
// review time instead, and names the file.
const CLIENT_FILES = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(js|ts)$/.test(e.name)) CLIENT_FILES.push(p);
  }
})(path.join(ROOT, 'src'));
CLIENT_FILES.push(path.join(ROOT, 'crm-index-core.js'));
for (const d of ['stripe-webhook']) {
  const p = path.join(ROOT, 'supabase', 'functions', d, 'index.ts');
  if (fs.existsSync(p)) CLIENT_FILES.push(p);
}

// Scoped to the `invoices` table on purpose. `referrals.status = 'paid'` means
// a commission was settled and has nothing to do with this guard -- matching on
// the words alone reported it, which is the same read-the-text-not-the-meaning
// mistake that let the dead GMP tiles through.
const PAID_COLS = /\b(paid_at|paid_amount|paid_method|stripe_session_id)\s*:/;
const PAID_STATUS = /\bstatus\s*:\s*['"]paid['"]/;
const offenders = [];
for (const f of CLIENT_FILES) {
  const src = read(f);
  // Look at what follows each reference to the invoices table, so the match is
  // anchored to the table being written rather than to a bare word.
  const table = /(?:from\(\s*['"]invoices['"]\s*\)|rest\/v1\/invoices)/g;
  let m;
  while ((m = table.exec(src)) !== null) {
    const window = src.slice(m.index, m.index + 400);
    const updates = /\.update\(|method:\s*'PATCH'/.test(window);
    if (!updates) continue;
    if (!PAID_COLS.test(window) && !PAID_STATUS.test(window)) continue;
    const line = src.slice(0, m.index).split(/\r?\n/).length;
    const snippet = window.replace(/\s+/g, ' ').slice(0, 100);
    offenders.push(rel(f) + ':' + line + '  ' + snippet);
  }
}
check('no client or edge code writes paid state directly', offenders.length === 0,
  offenders.join('\n') +
  (offenders.length ? '\nRoute these through gl_record_manual_payment / ' +
    'gl_apply_payment_event / gl_reverse_invoice_payments. The database ' +
    'trigger will refuse them at runtime with 42501.' : ''));

// ── 4. The webhook actually uses the RPCs ────────────────────────────────────
const webhookPath = path.join(ROOT, 'supabase', 'functions', 'stripe-webhook', 'index.ts');
if (fs.existsSync(webhookPath)) {
  const wh = read(webhookPath);
  check('stripe-webhook applies payments through gl_apply_payment_event',
    /rpc\/gl_apply_payment_event/.test(wh));
  check('stripe-webhook applies refunds through gl_apply_refund_event',
    /rpc\/gl_apply_refund_event/.test(wh));
  check('stripe-webhook no longer PATCHes the invoices table',
    !/rest\/v1\/invoices\?[^`]*`,\s*\{\s*method:\s*'PATCH'/.test(wh) &&
    !/method:\s*'PATCH'[\s\S]{0,400}status:\s*'paid'/.test(wh),
    'A PATCH here bypasses idempotency entirely.');
  check('a duplicate event is answered 200, not 500',
    /duplicate_event[\s\S]{0,400}status:\s*200/.test(wh),
    'Returning 500 for a duplicate makes Stripe retry an event that was ' +
    'already applied, forever.');
  check('the event id, not the session id, is the idempotency key',
    /eventId:\s*String\(event\?\.id/.test(wh),
    'Stripe reuses a session across redeliveries; it is the event that repeats.');
}

console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed') + '\n');
process.exit(failures ? 1 : 0);
