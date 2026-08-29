/*
 * checked-inserts.test.cjs — a record the database refused to create must not
 * appear in the UI as though it exists.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four creation paths invented a synthetic id when the INSERT failed:
 *
 *     const {data:newD} = await supa.from('deals').insert([...]).select().single();
 *     const did = newD ? newD.id : 'tmp_' + Date.now();
 *     deals[stage].push({id: did, ...});
 *
 * The user sees the deal, referral, referrer or client created. It is gone on
 * reload. Anything keyed to that id in the meantime — uploaded compliance
 * documents, follow-up writes — points at a row that was never created.
 *
 * The client path was the worst: its comment read "Always add to local array",
 * a "✓ Client saved!" toast fired unconditionally, and the W-9 / tax-exempt /
 * PA-letter uploads ran against the placeholder id, orphaning real files in
 * storage under a key nothing references.
 *
 * All four now go through glCheckedInsert and stop on failure.
 *
 * NOT INCLUDED: index.html's saveInvoice. It has the same shape but is
 * unreachable — cNav runs nav guards first and crm-permissions.js
 * unconditionally intercepts the 'newinv' page, so #cpg-newinv never
 * activates. The live invoice write is crm-invoice-patches.js, which already
 * checks its result. Verified before deciding to leave it alone; "fixing"
 * dead code would add risk for no benefit.
 *
 * Run:  node tests/checked-inserts.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

function extract(name) {
  const start = html.indexOf('async function ' + name);
  if (start === -1) return null;
  let depth = 0, seen = false;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') { depth++; seen = true; }
    else if (html[i] === '}') { depth--; if (seen && depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}

function makeSupa(mode) {
  const build = () => {
    const q = {
      insert() { return q; },
      select() { return q; },
      single() {
        if (mode === 'error')  return Promise.resolve({ data: null, error: { message: 'permission denied' } });
        if (mode === 'nodata') return Promise.resolve({ data: null, error: null });
        if (mode === 'throw')  return Promise.reject(new Error('socket hang up'));
        return Promise.resolve({ data: { id: 'real-uuid-1' }, error: null });
      },
    };
    return q;
  };
  return { from: build };
}

async function callHelper(src, mode) {
  const sandbox = { window: { supa: makeSupa(mode) }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + '\n; globalThis.__fn = glCheckedInsert;', sandbox);
  return sandbox.__fn(sb => sb.from('deals').insert([{ a: 1 }]).select().single());
}

(async () => {
  console.log('creation paths — a refused INSERT must not produce a local record\n');

  // ── structural: no synthetic-id fallbacks on live paths ──────────────
  const fallbacks = [
    { re: /const did = newD \? newD\.id : 'tmp_'/,               what: "deals: 'tmp_' + Date.now()" },
    { re: /const id = newRef \? newRef\.id : \('ref'\+/,          what: "referrals: 'ref' + length" },
    { re: /const rid = newRr \? newRr\.id : 'rr'\+/,              what: "referrers: 'rr' + length" },
  ];
  for (const f of fallbacks) {
    check('no synthetic-id fallback — ' + f.what, !f.re.test(html));
  }

  // Each live creation path must bail before pushing into its local array.
  const paths = [
    { fn: 'saveReferral',  push: 'referrals.push' },
    { fn: 'saveReferrer',  push: 'referrers.push' },
    { fn: 'saveNewDeal',   push: 'deals[stage].push' },
  ];
  for (const p of paths) {
    const src = extract(p.fn) || '';
    const guardAt = src.indexOf('ins.ok');
    const pushAt = src.indexOf(p.push);
    check(p.fn + ' guards before pushing into the local array',
      guardAt !== -1 && pushAt !== -1 && guardAt < pushAt,
      'guard at ' + guardAt + ', push at ' + pushAt);
    check(p.fn + ' routes through glCheckedInsert', /glCheckedInsert/.test(src));
  }

  // The client path must stop before uploading documents against a fake id.
  const clientSrc = extract('saveNewClient') || '';
  const guardAt  = clientSrc.indexOf('cid === localId');
  const uploadAt = clientSrc.indexOf('uploadComplianceDoc');
  const pushAt   = clientSrc.indexOf('clients.push');
  check('saveNewClient stops before uploading compliance documents',
    guardAt !== -1 && uploadAt !== -1 && guardAt < uploadAt,
    'guard at ' + guardAt + ', first upload at ' + uploadAt);
  check('saveNewClient stops before adding to the local array',
    guardAt !== -1 && pushAt !== -1 && guardAt < pushAt);
  check('the "Always add to local array" comment is gone',
    !/Always add to local array/.test(html));

  // This used to require the dead duplicate to carry a "DEAD CODE" label, so
  // nobody would repair the copy that never runs. The duplicate has since been
  // removed outright (GL-044) — labelling it was the weaker fix, and it did
  // not stop the trap being real. Assert the stronger property instead: there
  // is only one saveReferrer, so there is no wrong one to repair.
  check('saveReferrer is declared exactly once',
    (html.match(/function saveReferrer\(\)/g) || []).length === 1,
    'a second top-level declaration silently wins over the first — see ' +
    'tests/duplicate-declarations.test.cjs');

  // ── the helper's contract ────────────────────────────────────────────
  console.log('');
  const src = extract('glCheckedInsert');
  check('glCheckedInsert found in index.html', !!src);
  if (!src) { console.log('\n' + failures + ' CHECK(S) FAILED'); process.exit(1); }

  let r = await callHelper(src, 'ok');
  check('success -> ok:true and the real row is returned',
    r.ok === true && r.row && r.row.id === 'real-uuid-1', JSON.stringify(r));

  r = await callHelper(src, 'error');
  check('database error -> ok:false', r.ok === false);
  check('database error -> reason carries the message', /permission denied/i.test(r.reason || ''));

  r = await callHelper(src, 'nodata');
  check('no row returned -> ok:false (not silently treated as success)', r.ok === false, JSON.stringify(r));

  r = await callHelper(src, 'throw');
  check('thrown error -> ok:false rather than an unhandled rejection', r.ok === false, JSON.stringify(r));

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
