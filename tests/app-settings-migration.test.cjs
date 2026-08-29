/*
 * app-settings-migration.test.cjs — regression guard for the one-time
 * localStorage -> app_settings migration in src/services/auth.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * _bridgeLegacySettings() reads ten settings out of localStorage, deletes the
 * localStorage keys, and sets gl_settings_migrated=1 so it never runs again.
 * If it deletes before the database write lands, the values are gone: the
 * in-memory cache it copied them into is discarded on the next page load, and
 * the guard flag stops the migration from ever retrying. That silently loses
 * the SMS recipient and alert phone, five notification toggles, the Dropbox
 * Sign template map, the Stripe publishable key and the Sentry DSN.
 *
 * Run:  node app-settings-migration.test.cjs [path-to-src/services/auth.js]
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const TARGET = process.argv[2] || path.join(__dirname, '..', 'src/services/auth.js');

const LEGACY = {
  gl_sms_to: '"ops@goodliquid.com"',
  gl_sms_alert_phone: '"+18435551212"',
  gl_sms_paid: 'true',
  gl_sms_won: 'true',
  gl_sms_quote: 'false',
  gl_sms_tour: 'true',
  gl_sms_overdue: 'true',
  gl_sign_templates: '{"nda":"tpl_9f3","copack":"tpl_2a1"}',
  gl_stripe_pub: '"pk_live_51NotARealKey"',
  gl_sentry_dsn: '"https://abc123@o0.ingest.sentry.io/42"',
};

function makeLocalStorage(seed) {
  const store = Object.assign({}, seed);
  return {
    _store: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

/*
 * What `select` returns matters as much as what `upsert` does.
 * 20260525_security_hardening.sql seeds app_settings with EMPTY defaults for
 * sign_templates ({}), stripe_pub_key (null) and sentry_dsn (null). Those rows
 * load into GL_APP_SETTINGS before the bridge runs, so a naive
 * `key in GL_APP_SETTINGS` guard treats them as already migrated and skips the
 * localStorage copy — while the cleanup still deletes it. That destroys three
 * real settings. SEEDED_ROWS reproduces production; [] is the empty-table case.
 */
const SEEDED_ROWS = [
  { key: 'sign_templates', value: {} },
  { key: 'stripe_pub_key', value: null },
  { key: 'sentry_dsn', value: null },
  { key: 'service_packages', value: [] },
  { key: 'ccp_limits', value: {} },
];

/* Minimal Supabase double. `mode` controls what the upsert does. */
function makeSupa(mode, captured, seeded) {
  return {
    auth: { signInWithPassword: async () => ({}), signOut: async () => ({}) },
    from() {
      return {
        select: async () => ({ data: seeded || [], error: null }),
        upsert: async (rows) => {
          if (mode === 'reject') return { data: null, error: { message: 'new row violates row-level security policy' } };
          if (mode === 'throw') throw new Error('network down');
          captured.push(...(Array.isArray(rows) ? rows : [rows]));
          return { data: rows, error: null };
        },
      };
    },
  };
}

/* Load src/services/auth.js into a sandbox with just enough of a browser to run. */
function loadModule(localStorage, supa) {
  const src = fs.readFileSync(TARGET, 'utf8');
  const win = {
    GL_HOOKS: { registerLoginHook() {}, registerLogoutHook() {}, registerRenderHook() {} },
    GL_APP_SETTINGS: {},
    supa,
    localStorage,
    console,
    setTimeout,
    addEventListener() {},
  };
  win.window = win;
  const sandbox = {
    window: win,
    localStorage,
    console,
    setTimeout,
    fetch: async () => ({ json: async () => ({}) }),
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: TARGET });
  return win;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

async function scenario(label, mode, seeded) {
  console.log('\n' + label);
  const ls = makeLocalStorage(LEGACY);
  const captured = [];
  const supa = makeSupa(mode, captured, seeded);
  const win = loadModule(ls, supa);

  await win.glLoadAppSettings();

  const remaining = Object.keys(LEGACY).filter((k) => ls.getItem(k) !== null);
  const migrated = ls.getItem('gl_settings_migrated') === '1';

  if (mode === 'ok') {
    check('all ten settings written to the database',
      captured.length === 10,
      'wrote ' + captured.length + ' rows: ' + captured.map((r) => r.key).join(', '));
    check('sms_alert_phone survived with its value',
      captured.some((r) => r.key === 'sms_alert_phone' && r.value === '+18435551212'));
    check('sign_templates parsed as an object, not a string',
      captured.some((r) => r.key === 'sign_templates' && r.value && r.value.nda === 'tpl_9f3'));
    check('legacy localStorage keys cleaned up after a successful write',
      remaining.length === 0,
      remaining.length + ' left behind');
    check('migration marked complete', migrated);
  } else {
    // The database write failed. The ONLY copy of these settings is localStorage.
    check('database write did not silently succeed', captured.length === 0);
    check('all ten settings still in localStorage — not destroyed',
      remaining.length === 10,
      'only ' + remaining.length + '/10 survived; ' +
      Object.keys(LEGACY).filter((k) => ls.getItem(k) === null).join(', ') + ' were lost');
    check('migration NOT marked complete, so it retries next login',
      !migrated,
      'gl_settings_migrated was set despite the failed write — the migration can never run again');
  }
}

/*
 * The seeded-defaults case. The three keys the security-hardening migration
 * seeds empty must STILL migrate their real localStorage values, because an
 * empty seed is not a value anyone chose.
 */
async function seededScenario() {
  console.log('\nScenario 4: app_settings pre-seeded with empty defaults (production shape)');
  const ls = makeLocalStorage(LEGACY);
  const captured = [];
  const win = loadModule(ls, makeSupa('ok', captured, SEEDED_ROWS));

  await win.glLoadAppSettings();

  const wrote = (k) => captured.find((r) => r.key === k);
  check('sign_templates migrated despite being seeded as {}',
    !!wrote('sign_templates') && wrote('sign_templates').value.nda === 'tpl_9f3',
    'seeded empty default masked the real value and it was deleted');
  check('stripe_pub_key migrated despite being seeded as null',
    !!wrote('stripe_pub_key') && wrote('stripe_pub_key').value === 'pk_live_51NotARealKey');
  check('sentry_dsn migrated despite being seeded as null',
    !!wrote('sentry_dsn') && String(wrote('sentry_dsn').value).includes('sentry.io'));
  check('all ten settings still migrated in total',
    captured.length === 10,
    'wrote ' + captured.length + ': ' + captured.map((r) => r.key).join(', '));
}

/* A real admin-set value in the database must never be clobbered by a stale local copy. */
async function dbWinsScenario() {
  console.log('\nScenario 5: database holds a real value — it must win');
  const ls = makeLocalStorage(LEGACY);
  const captured = [];
  const win = loadModule(ls, makeSupa('ok', captured, [
    { key: 'sign_templates', value: { nda: 'tpl_NEWER_FROM_DB' } },
    { key: 'sms_alert_phone', value: '+18439999999' },
  ]));

  await win.glLoadAppSettings();

  check('did not overwrite the real sign_templates in the database',
    !captured.find((r) => r.key === 'sign_templates'));
  check('did not overwrite the real sms_alert_phone in the database',
    !captured.find((r) => r.key === 'sms_alert_phone'));
  check('still migrated the eight keys the database did not have',
    captured.length === 8,
    'wrote ' + captured.length + ': ' + captured.map((r) => r.key).join(', '));
  check('database value is what stays in the cache',
    win.GL_APP_SETTINGS.sign_templates.nda === 'tpl_NEWER_FROM_DB');
}

(async () => {
  console.log('app_settings migration — ' + path.relative(process.cwd(), TARGET));
  await scenario('Scenario 1: database write succeeds', 'ok');
  await scenario('Scenario 2: database rejects the write (RLS)', 'reject');
  await scenario('Scenario 3: database call throws (network)', 'throw');
  await seededScenario();
  await dbWinsScenario();

  console.log('\n' + (failures === 0
    ? 'ALL PASSED'
    : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
