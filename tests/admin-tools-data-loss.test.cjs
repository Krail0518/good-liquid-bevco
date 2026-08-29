/*
 * admin-tools-data-loss.test.cjs — admin tools must not destroy the only copy
 * of data, or report a change they did not make.
 *
 * THREE DEFECTS, one theme: a tool that says it did something it did not.
 *
 * GL-024 — "Clear local cache" listed sixteen legacy blobs under the heading
 * "APP STATE (safe to wipe)", with the copy "Cloud data (Supabase) is
 * untouched", and PRE-CHECKED every key that had data. Those keys are the
 * sources the index.html backfills read, and each backfill deliberately bails
 * WITHOUT setting its `<key>_migrated` flag when the insert is rejected — the
 * blob is kept on purpose as the surviving copy. So the screen invited an
 * admin, one click, to delete data that exists nowhere else, while telling
 * them it was safe.
 *
 * GL-023 — "Reset CCP limits to defaults" removed only the browser copy.
 * readLimits() prefers the org-wide app_settings value, so the override still
 * won and the next form was judged against the old numbers while the UI said
 * the limits were reset. These are FDA critical limits: pasteurisation
 * temperature and hold time, hot-fill temperature.
 *
 * Underneath both: glSaveAppSetting had no .select(), so an RLS rejection
 * returned true. Every caller that trusts that boolean — including the limits
 * editor — would report success for a write that never landed.
 *
 * Run:  node tests/admin-tools-data-loss.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const adminTools = fs.readFileSync(path.join(ROOT, 'crm-admin-tools.js'), 'utf8');
const compliance = fs.readFileSync(path.join(ROOT, 'src/modules/production/compliance.js'), 'utf8');
const auth = fs.readFileSync(path.join(ROOT, 'crm-auth.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('admin tools — no silent data loss, no false confirmations\n');

/* ── GL-024: clear local cache ─────────────────────────────────────── */
check('the "safe to wipe" claim is gone from the APP STATE heading',
  !/APP STATE \(safe to wipe\)/.test(adminTools),
  'the heading still asserts every listed key is safe');

check('migration state is consulted before offering a key for deletion',
  /_migrated/.test(adminTools) && /function migrationState/.test(adminTools),
  'no per-key migration check found');

check('un-migrated keys are NOT pre-checked',
  /var preCheck = hasData && state !== 'unmigrated'/.test(adminTools),
  'the checkbox is still checked purely on the presence of data');

check('un-migrated keys warn that this is the only copy',
  /destroys the only copy/.test(adminTools));

check('deleting an un-migrated key needs a second explicit confirmation',
  /PERMANENT DATA LOSS/.test(adminTools) && /data-risky/.test(adminTools),
  'no second gate found for keys holding the only copy');

check('genuinely transient keys are declared rather than assumed',
  /TRANSIENT_KEYS/.test(adminTools));

/* ── GL-023: CCP limits ────────────────────────────────────────────── */
// Anchor on the listener, not the button markup — '#gl-lim-reset' appears
// first in the modal HTML, and a window measured from there does not reach
// the handler.
const RESET_AT = compliance.indexOf("#gl-lim-reset').addEventListener");
const RESET_BODY = RESET_AT === -1 ? '' : compliance.slice(RESET_AT, RESET_AT + 2200);

check('reset clears the org-wide override, not just localStorage',
  /glSaveAppSetting\('ccp_limits', \{\}\)/.test(RESET_BODY),
  'the reset handler still only removes the local key');

check('reset clears the in-memory cache too',
  /GL_APP_SETTINGS\.ccp_limits = \{\}/.test(RESET_BODY));

check('a failed reset is reported as a failure',
  /gl-lim-reset[\s\S]{0,1400}?Reset failed/.test(compliance),
  'the reset still confirms unconditionally');

check('reset writes an audit entry',
  /ccp_limits_reset/.test(compliance));

check('writeLimits reports whether the org-wide write landed',
  /async function writeLimits/.test(compliance) && /return !!ok/.test(compliance),
  'writeLimits still swallows the result');

check('a failed save is reported and does not close the editor',
  /gl-lim-save[\s\S]{0,1200}?Save failed/.test(compliance));

check('a failed save writes no audit entry',
  (() => {
    const at = compliance.indexOf("#gl-lim-save').addEventListener");
    const body = compliance.slice(at, at + 1400);
    const failAt = body.indexOf('Save failed');
    const auditAt = body.indexOf('ccp_limits_changed');
    return failAt !== -1 && auditAt !== -1 && failAt < auditAt;
  })(),
  'the audit entry is not guarded by the save result');

/* ── the shared root cause ─────────────────────────────────────────── */
console.log('');
check('glSaveAppSetting asks for rows back',
  /upsert\([^)]*\)\.select\('key'\)/.test(auth),
  "no .select() on the app_settings upsert — a 0-row RLS rejection reads as success");

check('glSaveAppSetting returns false on a 0-row result',
  /r\.data\.length === 0[\s\S]{0,200}?return false/.test(auth));

check('the in-memory cache is only updated after the server confirms',
  (() => {
    const at = auth.indexOf('window.glSaveAppSetting');
    const body = auth.slice(at, at + 1400);
    const guardAt = body.indexOf('r.data.length === 0');
    const cacheAt = body.indexOf('window.GL_APP_SETTINGS[key] = value');
    return guardAt !== -1 && cacheAt !== -1 && guardAt < cacheAt;
  })(),
  'the cache is written before the result is known, so a failed save leaves this browser disagreeing with every other one');

/* ── behavioural: glSaveAppSetting against a fake PostgREST ────────── */
function extractFn(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; }
    else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1) + ';'; }
  }
  return null;
}

async function runSave(mode) {
  const fnSrc = extractFn(auth, 'window.glSaveAppSetting = async function');
  if (!fnSrc) return { err: 'could not extract glSaveAppSetting' };
  const sandbox = {
    console,
    window: { GL_APP_SETTINGS: {} },
    getSupa: () => ({
      from: () => {
        const q = {
          upsert() { return q; },
          select() {
            if (mode === 'error')  return Promise.resolve({ data: null, error: { message: 'permission denied' } });
            if (mode === 'norows') return Promise.resolve({ data: [], error: null });
            return Promise.resolve({ data: [{ key: 'ccp_limits' }], error: null });
          },
        };
        return q;
      },
    }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox);
  const ok = await sandbox.window.glSaveAppSetting('ccp_limits', { htst_temp_f: 170 });
  return { ok, cache: sandbox.window.GL_APP_SETTINGS.ccp_limits };
}

(async () => {
  console.log('');
  let r = await runSave('ok');
  check('save succeeds -> true, and the cache is updated',
    r.ok === true && r.cache && r.cache.htst_temp_f === 170, JSON.stringify(r));

  r = await runSave('norows');
  check('0 rows (silent RLS rejection) -> false', r.ok === false, JSON.stringify(r));
  check('0 rows -> the cache is NOT updated', r.cache === undefined, JSON.stringify(r));

  r = await runSave('error');
  check('database error -> false', r.ok === false, JSON.stringify(r));
  check('database error -> the cache is NOT updated', r.cache === undefined, JSON.stringify(r));

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
