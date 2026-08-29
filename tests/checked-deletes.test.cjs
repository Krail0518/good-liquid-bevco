/*
 * checked-deletes.test.cjs — a delete that the database refused must not be
 * reported as a deletion.
 *
 * WHY THIS EXISTS
 * ---------------
 * Seven delete paths in index.html checked only `r.error`. PostgREST does not
 * return the deleted rows unless you ask with .select(), and RLS rejects
 * silently — 0 rows, no error — so a refused delete looked identical to a
 * successful one. Each site then purged its local cache, re-rendered, and
 * called glAudit(), writing an audit entry for a deletion that never happened.
 *
 * A false audit entry is worse than a failed delete. The record says the thing
 * is gone; the database says it is there; nothing reconciles them. For a
 * system carrying FDA-relevant history that is the expensive failure.
 *
 * One site (removeTag / client_tags) had no check at all, not even .error.
 *
 * All seven now go through glCheckedDelete. This file drives that helper
 * directly — it depends only on window.supa, so no browser is needed — and
 * asserts structurally that no unchecked delete has crept back in.
 *
 * Run:  node tests/checked-deletes.test.cjs
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

/* Pull the helper out of the page so the test cannot drift from what ships. */
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

function makeSupa(mode, calls) {
  const build = (table) => {
    const q = {
      delete() { calls.push({ table, eqs: [] }); return q; },
      eq(c, v) { calls[calls.length - 1].eqs.push(c + '=' + v); return q; },
      select(cols) {
        calls[calls.length - 1].selected = cols || '*';
        if (mode === 'error')  return Promise.resolve({ data: null, error: { message: 'permission denied' } });
        if (mode === 'norows') return Promise.resolve({ data: [], error: null });
        if (mode === 'throw')  return Promise.reject(new Error('socket hang up'));
        return Promise.resolve({ data: [{ id: 'row-1' }], error: null });
      },
    };
    return q;
  };
  return { from: build };
}

async function callHelper(src, mode, build) {
  const calls = [];
  const sandbox = { window: { supa: makeSupa(mode, calls) }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + '\n; globalThis.__fn = glCheckedDelete;', sandbox);
  const res = await sandbox.__fn(build);
  return { res, calls };
}

(async () => {
  console.log('deletes — a refused delete must not be recorded as one\n');

  // ── structural: nothing unchecked left ───────────────────────────────
  // Runs first and unconditionally so a regression names itself rather than
  // stopping at "helper not found".
  const deleteLines = html.split(/\r?\n/)
    .map((l, i) => ({ n: i + 1, l }))
    .filter(x => /\.delete\(\)/.test(x.l));
  const unchecked = deleteLines.filter(x => !/\.select\(/.test(x.l));
  check('every .delete() asks for the removed rows back (.select)',
    unchecked.length === 0,
    unchecked.map(x => '  line ' + x.n + ': ' + x.l.trim()).join('\n'));

  check('at least the seven known delete sites are present',
    deleteLines.length >= 7, 'found ' + deleteLines.length);

  // The audit entry must be written only after the guard, never before.
  for (const fn of ['deleteTask', 'deleteDoc', 'deleteTimeEntry', 'deleteClientNote']) {
    const src = extract(fn);
    if (!src) { check(fn + ' present', false); continue; }
    const guardAt = src.indexOf('res.ok');
    const auditAt = src.indexOf('glAudit');
    check(fn + ': glAudit runs only after the rows-affected guard',
      guardAt !== -1 && (auditAt === -1 || auditAt > guardAt),
      'guard at ' + guardAt + ', glAudit at ' + auditAt);
  }

  const delClient = extract('deleteClientHard') || extract('deleteClient') || '';
  check('client delete purges the local cache only after the guard',
    !delClient || delClient.indexOf('res.ok') < delClient.indexOf('window.clients ='),
    'local cache mutation appears before the guard');

  // ── the helper's contract ────────────────────────────────────────────
  console.log('');
  const src = extract('glCheckedDelete');
  check('glCheckedDelete found in index.html', !!src);
  if (!src) { console.log('\n' + failures + ' CHECK(S) FAILED'); process.exit(1); }

  let r = await callHelper(src, 'ok', sb => sb.from('tasks').delete().eq('id', 'row-1').select('id'));
  check('success -> ok:true with a count', r.res.ok === true && r.res.count === 1, JSON.stringify(r.res));
  check('success -> the query asked for rows back', !!r.calls[0].selected);

  r = await callHelper(src, 'norows', sb => sb.from('tasks').delete().eq('id', 'row-1').select('id'));
  check('0 rows removed -> ok:false (the silent RLS rejection)', r.res.ok === false, JSON.stringify(r.res));
  check('0 rows removed -> reason says it was rejected',
    /0 rows|rejected/i.test(r.res.reason || ''), JSON.stringify(r.res));

  r = await callHelper(src, 'error', sb => sb.from('tasks').delete().eq('id', 'row-1').select('id'));
  check('database error -> ok:false', r.res.ok === false);
  check('database error -> reason carries the message', /permission denied/i.test(r.res.reason || ''));

  r = await callHelper(src, 'throw', sb => sb.from('tasks').delete().eq('id', 'row-1').select('id'));
  check('thrown error -> ok:false rather than an unhandled rejection', r.res.ok === false, JSON.stringify(r.res));

  // Multi-column deletes (client_tags uses two .eq()) must work the same way.
  r = await callHelper(src, 'norows',
    sb => sb.from('client_tags').delete().eq('client_id', 'c1').eq('tag', 'vip').select('tag'));
  check('two-column delete -> 0 rows still reported as failure', r.res.ok === false);
  check('two-column delete -> both filters applied',
    r.calls[0].eqs.length === 2, JSON.stringify(r.calls[0]));

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
