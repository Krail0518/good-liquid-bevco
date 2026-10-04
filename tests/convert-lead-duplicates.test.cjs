/*
 * convert-lead-duplicates.test.cjs — converting a pipeline lead must not make
 * a second client.
 *
 * WHY THIS EXISTS
 * ---------------
 * "🚀 Convert to Client & Onboard" inserted a new client every time it ran.
 * It never checked whether the lead was already a client, never linked the
 * deal to the client it made, and nothing stopped a second click while the
 * first conversion (several seconds of inserts, an RPC and an email) was
 * still running. KEWE Energy ended up with three client records on
 * 2026-10-04, two of them made nine seconds apart, each sending the customer
 * its own onboarding link; The Other Matcha got two on 2026-09-23.
 *
 * This loads the real src/modules/customers/onboarding.js against a fake
 * Supabase client and checks the three behaviours that prevent it:
 *   1. a lead whose deal already points at a client sends onboarding to that
 *      client and inserts nothing;
 *   2. a lead matching an existing client by email does the same;
 *   3. two overlapping clicks on a new lead create exactly one client, and
 *      the deal is linked to it.
 *
 * Run:  node tests/convert-lead-duplicates.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'customers', 'onboarding.js'), 'utf8');

// The email/name match is shared with Add Client and lives in
// crm-index-core.js, which loads before this module in index.html. Load the
// real one rather than a stub, so this test covers the lookup actually used.
const CORE = fs.readFileSync(path.join(__dirname, '..', 'crm-index-core.js'), 'utf8').replace(/\r\n/g, '\n');
const HELPER = (() => {
  const start = CORE.indexOf('window.glFindDuplicateClient = ');
  if (start === -1) throw new Error('window.glFindDuplicateClient not found in crm-index-core.js');
  return CORE.slice(start, CORE.indexOf('\n};\n', start) + 4);
})();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

// A tiny in-memory Supabase: enough of the query builder for this module.
function makeDb(seed) {
  const tables = {
    clients: (seed.clients || []).map(r => Object.assign({}, r)),
    deals: (seed.deals || []).map(r => Object.assign({}, r)),
    onboarding: [],
    deal_documents: [],
  };
  const log = { inserts: [], updates: [] };
  let n = 0;

  function from(table) {
    const st = { op: 'select', filters: [], payload: null, limit: null };
    const rows = () => tables[table].filter(r => st.filters.every(f => f(r)));
    function result() {
      if (st.op === 'insert') {
        const made = st.payload.map(p => Object.assign({ id: table + '-new-' + (++n) }, p));
        tables[table].push(...made);
        log.inserts.push({ table, rows: made });
        return { data: made, error: null };
      }
      if (st.op === 'update') {
        const hit = rows();
        hit.forEach(r => Object.assign(r, st.payload));
        log.updates.push({ table, payload: st.payload, count: hit.length });
        return { data: hit.map(r => ({ id: r.id })), error: null };
      }
      let out = rows();
      if (st.limit != null) out = out.slice(0, st.limit);
      return { data: out, error: null };
    }
    // Every await is a real async gap, so overlapping clicks can interleave.
    const later = v => new Promise(res => setTimeout(() => res(v), 5));
    const q = {
      select() { return q; },
      insert(p) { st.op = 'insert'; st.payload = p; return q; },
      update(p) { st.op = 'update'; st.payload = p; return q; },
      eq(col, val) { st.filters.push(r => r[col] === val); return q; },
      ilike(col, pat) {
        const lit = pat.replace(/\\([\\%_])/g, '$1').toLowerCase();
        st.filters.push(r => String(r[col] || '').toLowerCase() === lit);
        return q;
      },
      order() { return q; },
      limit(k) { st.limit = k; return q; },
      maybeSingle() { const r = result(); return later({ data: r.data[0] || null, error: null }); },
      single() { const r = result(); return later({ data: r.data[0] || null, error: r.data[0] ? null : { message: 'no row' } }); },
      then(ok, bad) { return later(result()).then(ok, bad); },
    };
    return q;
  }
  function rpc(name, args) {
    if (name !== 'gl_onboarding_create') throw new Error('unexpected rpc ' + name);
    const row = { id: 'ob-' + (++n), client_id: args.p_client_id, token: 'tok' + n, status: 'invited', created_at: new Date().toISOString() };
    tables.onboarding.push(row);
    return new Promise(res => setTimeout(() => res({ data: { ok: true, id: row.id, token: row.token }, error: null }), 5));
  }
  return { supa: { from, rpc }, tables, log };
}

function load(db, deal) {
  const alerts = [], sent = [];
  const win = {
    supa: db.supa,
    deals: { Proposal: [deal] },
    currentDealStage: 'Proposal',
    currentDealIdx: 0,
    sendMailgunEmail: async (to) => { sent.push(to); return true; },
    clients: [],
  };
  const ctx = {
    window: win,
    location: { origin: 'https://example.test' },
    alert: m => alerts.push(String(m)),
    confirm: () => true,
    prompt: () => null,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, document: { getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(HELPER, ctx);
  vm.runInContext(SRC, ctx);
  return { win, alerts, sent };
}

const DEAL = { id: 'deal-1', co: 'KEWE Energy', contactName: 'Frantz Brignol', email: 'official@drinkkewe.com' };
const clientInserts = db => db.log.inserts.filter(i => i.table === 'clients').length;

(async () => {
  console.log('1. Deal already linked to a client');
  {
    const db = makeDb({
      clients: [{ id: 'c-kewe', name: 'KEWE Energy', email: 'other@drinkkewe.com', contact_name: 'Frantz' }],
      deals: [{ id: 'deal-1', client_id: 'c-kewe' }],
    });
    const { win, sent } = load(db, DEAL);
    await win.glConvertLeadToOnboarding();
    check('no client inserted', clientInserts(db) === 0, clientInserts(db) + ' inserted');
    check('onboarding sent to the existing client', sent.length === 1 && db.tables.onboarding[0] && db.tables.onboarding[0].client_id === 'c-kewe');
  }

  console.log('2. Lead matches an existing client by email (case and _ wildcard safe)');
  {
    const db = makeDb({
      clients: [
        { id: 'c-decoy', name: 'Decoy', email: 'officialxdrinkkewe.com' },
        { id: 'c-kewe', name: 'Kewe Energy Inc', email: 'Official@DrinkKewe.com', contact_name: 'Frantz' },
      ],
      deals: [{ id: 'deal-1', client_id: null }],
    });
    const { win } = load(db, Object.assign({}, DEAL, { email: 'official@drinkkewe.com' }));
    await win.glConvertLeadToOnboarding();
    check('no client inserted', clientInserts(db) === 0, clientInserts(db) + ' inserted');
    check('deal linked to the matched client', db.tables.deals[0].client_id === 'c-kewe', 'client_id=' + db.tables.deals[0].client_id);
  }

  console.log('3. Two overlapping clicks on a new lead');
  {
    const db = makeDb({ clients: [], deals: [{ id: 'deal-1', client_id: null }] });
    const { win, alerts, sent } = load(db, DEAL);
    await Promise.all([win.glConvertLeadToOnboarding(), win.glConvertLeadToOnboarding()]);
    check('exactly one client inserted', clientInserts(db) === 1, clientInserts(db) + ' inserted');
    check('exactly one onboarding email', sent.length === 1, sent.length + ' sent');
    check('second click told to wait', alerts.some(a => /Already converting/.test(a)));
    const made = db.log.inserts.find(i => i.table === 'clients').rows[0];
    check('deal linked to the new client', db.tables.deals[0].client_id === made.id, 'client_id=' + db.tables.deals[0].client_id);

    // A third click after it finished finds the client through the deal link.
    await win.glConvertLeadToOnboarding();
    check('a later click still creates no second client', clientInserts(db) === 1, clientInserts(db) + ' inserted');
  }

  console.log(failures ? '\n' + failures + ' FAILED' : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
