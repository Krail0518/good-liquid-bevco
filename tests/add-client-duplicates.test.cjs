/*
 * add-client-duplicates.test.cjs — creating a client by hand must not make a
 * second copy of one we already have.
 *
 * WHY THIS EXISTS
 * ---------------
 * Production had three brands stored more than once (KEWE Energy x3, The
 * Other Matcha x2, Oriign LLC x2), cleaned up by hand on 2026-10-04. The
 * pipeline conversion was fixed separately; the two manual paths had the same
 * gaps:
 *   - "+ Add Client" (saveNewClient) inserted without looking for an existing
 *     client, and its Save button stayed live through the several seconds of
 *     document uploads, so a second click made a second client;
 *   - the Onboarding Wizard (src/shared/tools.js) inserted without looking
 *     either, and on a refused insert it still put a placeholder client on
 *     screen and announced "Client onboarded".
 *
 * Both now go through window.glConfirmNotDuplicate before inserting. This runs
 * the real helpers and the real double-click guard from crm-index-core.js
 * against a fake Supabase, and checks the ordering in both callers.
 *
 * Run:  node tests/add-client-duplicates.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Normalised: a Windows checkout has CRLF, CI has LF.
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const CORE = read(path.join(ROOT, 'crm-index-core.js'));
const TOOLS = read(path.join(ROOT, 'src', 'shared', 'tools.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

// The block from the duplicate helpers through the saveNewClient guard.
function coreBlock() {
  const start = CORE.indexOf('window.glFindDuplicateClient = ');
  const wrap = CORE.indexOf('async function saveNewClient(){');
  if (start === -1 || wrap === -1) return null;
  const end = CORE.indexOf('\n}\n', wrap);
  return CORE.slice(start, end + 3);
}

// clients rows; `fail` makes every query return an error.
function makeSupa(rows, fail) {
  const queries = [];
  return {
    queries,
    from(table) {
      const filters = [];
      let lim = null;
      const q = {
        select() { return q; },
        ilike(col, pat) {
          queries.push({ table, col, pat });
          // Undo the escaping to a literal, then compare case-insensitively:
          // what PostgREST does for an ilike pattern with no live wildcards.
          const lit = pat.replace(/\\([\\%_])/g, '$1').toLowerCase();
          filters.push(r => String(r[col] || '').toLowerCase() === lit);
          return q;
        },
        limit(n) { lim = n; return q; },
        then(ok, bad) {
          const res = fail ? { data: null, error: { message: 'connection reset' } }
                           : { data: rows.filter(r => filters.every(f => f(r))).slice(0, lim == null ? undefined : lim), error: null };
          return Promise.resolve(res).then(ok, bad);
        },
      };
      return q;
    },
  };
}

function load(supa, answers) {
  const alerts = [], confirms = [];
  const ctx = {
    window: { supa },
    alert: m => alerts.push(String(m)),
    confirm: m => { confirms.push(String(m)); return answers.confirm; },
    setTimeout,
    saveNewClientOnce: null,
  };
  vm.createContext(ctx);
  const src = coreBlock();
  if (!src) throw new Error('could not find the duplicate helpers in crm-index-core.js');
  vm.runInContext(src + '\nthis.saveNewClient = saveNewClient;', ctx);
  return { ctx, alerts, confirms };
}

const ROWS = [
  { id: 'c1', name: 'KEWE Energy', email: 'Official@DrinkKewe.com' },
  { id: 'c2', name: 'Decoy', email: 'officialxdrinkkewe.com' },
];

(async () => {
  console.log('glFindDuplicateClient');
  {
    const { ctx } = load(makeSupa(ROWS), { confirm: false });
    const f = ctx.window.glFindDuplicateClient;
    check('matches by email, ignoring case', ((await f('New Brand', 'official@drinkkewe.com')) || {}).id === 'c1');
    check('matches by name, ignoring case and outer spaces', ((await f('  kewe energy ', '')) || {}).id === 'c1');
    check('_ in an email is literal, not a wildcard', (await f('Nope', 'official_drinkkewe.com')) === null);
    check('no match returns null', (await f('Brand New Co', 'hello@brandnew.co')) === null);
  }

  console.log('glConfirmNotDuplicate');
  {
    let t = load(makeSupa(ROWS), { confirm: false });
    check('a new client goes ahead without asking', (await t.ctx.window.glConfirmNotDuplicate('Brand New Co', 'x@y.co')) === true && t.confirms.length === 0);
    t = load(makeSupa(ROWS), { confirm: false });
    const stopped = await t.ctx.window.glConfirmNotDuplicate('KEWE Energy', '');
    check('a duplicate asks, and Cancel stops the save', stopped === false && t.confirms.length === 1 && /already a client/.test(t.confirms[0]));
    t = load(makeSupa(ROWS), { confirm: true });
    check('a duplicate can still be created deliberately', (await t.ctx.window.glConfirmNotDuplicate('KEWE Energy', '')) === true);
    t = load(makeSupa(ROWS, true), { confirm: true });
    const onError = await t.ctx.window.glConfirmNotDuplicate('Brand New Co', 'x@y.co');
    check('a failed lookup stops the save instead of assuming no match', onError === false && t.alerts.length === 1, t.alerts.join(' | '));
  }

  console.log('saveNewClient double click');
  {
    const { ctx } = load(makeSupa([]), { confirm: true });
    let runs = 0;
    ctx.saveNewClientOnce = () => { runs++; return new Promise(r => setTimeout(r, 20)); };
    await Promise.all([ctx.saveNewClient(), ctx.saveNewClient(), ctx.saveNewClient()]);
    check('three overlapping clicks save once', runs === 1, runs + ' saves');
    await ctx.saveNewClient();
    check('a click after it finished saves again', runs === 2, runs + ' saves');
    ctx.saveNewClientOnce = () => Promise.reject(new Error('boom'));
    await ctx.saveNewClient().catch(() => {});
    ctx.saveNewClientOnce = () => { runs++; return Promise.resolve(); };
    await ctx.saveNewClient();
    check('a save that threw does not lock the button', runs === 3, runs + ' saves');
  }

  console.log('Callers check before inserting');
  {
    const s = CORE.indexOf('async function saveNewClientOnce(');
    const body = CORE.slice(s, CORE.indexOf('\n}\n', s));
    const dupAt = body.indexOf('glConfirmNotDuplicate');
    const insAt = body.indexOf(".from('clients').insert");
    check('Add Client checks for a duplicate before inserting', dupAt !== -1 && insAt !== -1 && dupAt < insAt, 'check at ' + dupAt + ', insert at ' + insAt);

    const w = TOOLS.indexOf("save.addEventListener('click'");
    const wiz = TOOLS.slice(w, TOOLS.indexOf('function stash()', w));
    const wDup = wiz.indexOf('glConfirmNotDuplicate');
    const wIns = wiz.indexOf(".from('clients').insert");
    const wGuard = wiz.indexOf('if(!cid)');
    const wPush = wiz.indexOf('window.clients.push');
    check('the wizard checks for a duplicate before inserting', wDup !== -1 && wIns !== -1 && wDup < wIns, 'check at ' + wDup + ', insert at ' + wIns);
    check('the wizard stops on a refused insert before showing the client', wGuard !== -1 && wPush !== -1 && wGuard < wPush);
    check('the wizard no longer invents a placeholder id', !/'c_' \+ Date\.now\(\)/.test(wiz));
  }

  console.log(failures ? '\n' + failures + ' FAILED' : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
