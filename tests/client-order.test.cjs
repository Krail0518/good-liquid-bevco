/*
 * client-order.test.cjs — every client picker is alphabetical because the one
 * clients array is.
 *
 * WHY THIS EXISTS
 * ---------------
 * About twenty client dropdowns (invoices, tasks, calendar, documents, AI
 * drafts, production, time tracking, quotes, ...) all render window.clients
 * in array order, and the array loaded newest-first. Sorting each dropdown
 * would leave the next new one unsorted, so the array itself is kept in name
 * order (glSortClients in crm-index-core.js). That only holds if:
 *   - the load and every local add re-sort, and a rename re-sorts;
 *   - nothing replaces the array, because `clients` and `window.clients` must
 *     stay one array. deleteClient used to assign a filtered copy to
 *     window.clients, leaving the Clients table (which reads `clients`)
 *     showing the deleted client until a reload;
 *   - code that wanted "newest clients" asks by date instead of taking the
 *     first N.
 *
 * Run:  node tests/client-order.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Normalised: a Windows checkout has CRLF, CI has LF.
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const CORE = read('crm-index-core.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

function body(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) return '';
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; }
    else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

console.log('glSortClients');
{
  const decl = CORE.slice(CORE.indexOf('let clients=window.clients=[];'), CORE.indexOf('window.glSortClients=glSortClients;') + 35);
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(decl + '\nthis.clients = clients;', ctx);
  const arr = ctx.window.clients;
  ['Zest Soda', 'apple fizz', 'Mango Co', 'Berry Bros', null].forEach((n, i) => arr.push({ id: String(i), name: n }));
  ctx.window.glSortClients();
  check('sorts by name, ignoring case', JSON.stringify(arr.map(c => c.name)) === JSON.stringify([null, 'apple fizz', 'Berry Bros', 'Mango Co', 'Zest Soda']), JSON.stringify(arr.map(c => c.name)));
  check('sorts in place, so clients and window.clients stay one array', ctx.clients === ctx.window.clients);
}

console.log('Everything that changes the array keeps the order');
{
  const load = body(CORE, 'async function loadSupabaseData(');
  const fill = load.indexOf('clients.length=0;');
  check('the load re-sorts after filling', fill !== -1 && load.indexOf('glSortClients()', fill) !== -1);

  // Every other local add in the staff CRM must re-sort right after the push.
  // The load's own pushes are covered above. The portal adds its one own
  // client to an otherwise empty array, so it has nothing to order against.
  const loadStart = CORE.indexOf(load), loadEnd = loadStart + load.length;
  const files = ['crm-index-core.js', 'src/shared/tools.js', 'src/modules/customers/onboarding.js',
                 'src/modules/customers/edit-client.js', 'src/shared/crm-extras.js', 'src/shared/public-ops.js'];
  let adds = 0;
  for (const f of files) {
    const src = read(f);
    const re = /\bclients\.push\(\{/g;
    let m;
    while ((m = re.exec(src))) {
      if (f === 'crm-index-core.js' && m.index >= loadStart && m.index < loadEnd) continue;
      adds++;
      const after = src.slice(src.indexOf('});', m.index), src.indexOf('});', m.index) + 200);
      const line = src.slice(0, m.index).split('\n').length;
      check(f + ':' + line + ' re-sorts after adding a client', /glSortClients\(\)/.test(after), after.slice(0, 80));
    }
  }
  check('found the Add Client and wizard adds', adds >= 2, adds + ' found');

  const edit = body(read('src/modules/customers/edit-client.js'), 'window.glUpdateClient = async function(');
  const sortAt = edit.indexOf('glSortClients()');
  check('a rename re-sorts before the list re-renders', sortAt !== -1 && sortAt < edit.lastIndexOf('renderClients()'));
}

console.log('Nothing replaces the array');
{
  const del = body(CORE, 'async function deleteClient(');
  check('deleteClient removes in place', /clients\.splice\(/.test(del));
  check('deleteClient no longer reassigns window.clients', !/window\.clients\s*=/.test(del));
  const shipped = ['crm-index-core.js', 'src/shared/tools.js', 'src/shared/crm-extras.js', 'src/shared/public-ops.js',
                   'src/modules/customers/onboarding.js', 'src/modules/customers/edit-client.js', 'src/modules/invoicing/invoice-builder.js'];
  for (const f of shipped) {
    // `window.clients = window.clients || []` only creates it when missing.
    const bad = read(f).split('\n').filter(l => /window\.clients\s*=(?!=)/.test(l) && !/window\.clients\s*=\s*window\.clients\s*\|\|/.test(l) && !/let clients=window\.clients=\[\]/.test(l));
    check(f + ' never assigns a new array to window.clients', bad.length === 0, bad.join(' | '));
  }
}

console.log('Callers that want "newest" ask by date');
{
  const ops = read('src/shared/public-ops.js');
  const at = ops.indexOf('var clientsList = ');
  const stmt = ops.slice(at, ops.indexOf(';', ops.indexOf('.slice(0, 20)', at)) + 1);
  check('Post Ideas takes the 20 most recent by createdAt', /createdAt/.test(stmt) && /\.sort\(/.test(stmt), stmt);
  const load = body(CORE, 'async function loadSupabaseData(');
  check('loaded clients carry createdAt', /createdAt:\s*c\.created_at/.test(load));
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nall passed');
process.exit(failures ? 1 : 0);
