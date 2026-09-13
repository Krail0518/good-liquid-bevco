/*
 * security-invariants-classifier.test.cjs — a probe that could not reach the
 * database must never be reported as exposed data.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-13 the daily Security invariants run failed with:
 *
 *     FAIL deals    — ANONYMOUS DATA VISIBLE: {"message":"Gateway Timeout"}
 *     FAIL profiles — ANONYMOUS DATA VISIBLE: {"message":"Gateway Timeout"}
 *
 * Nothing was exposed. The API gateway returned 504 after five seconds and the
 * request never reached Postgres. The script classified every response it did
 * not recognise as a refusal as a leak, so a timeout read as the worst finding
 * the system can produce. The run was re-run and went green.
 *
 * The damage is not the wasted hour. It is that the one alarm guarding the
 * 2026-08-06 hole now cries wolf, and its readers learn that a red run means
 * "re-run it" — the exact reflex that let the original hole live for months.
 * scripts/security-invariants.sh says so itself in section 4: "a check that
 * cries wolf gets ignored — which is how the real hole survived."
 *
 * Section 2b had the same defect pointing the other way, which is worse: it
 * PASSED a timeout, because a 504 body contains no client-identifying column
 * names either.
 *
 * So the probe now has three outcomes — ok / FAIL / UNVERIFIED — and this file
 * proves each one by running the real script against a stub that answers the
 * way production did that morning. It asserts the classification, not the
 * retry: a retry alone would only have made the wrong verdict rarer.
 *
 * Run:  node tests/security-invariants-classifier.test.cjs
 */

const http = require('http');
const { execFileSync, spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'security-invariants.sh');
const REPO = path.resolve(__dirname, '..');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const DENIED = JSON.stringify({
  code: '42501', details: null, hint: null,
  message: 'permission denied for table clients'
});
const TIMEOUT = JSON.stringify({ message: 'Gateway Timeout' });

/*
 * The stubs: PostgREST plus the marketing site. Each plan decides what the
 * table reads and deletes answer with; everything else answers the way a
 * healthy production does, so a scenario varies exactly one thing.
 *
 * `n` is how many times this table has been asked in this run, which is what
 * lets the "one blip then fine" plan below prove the retry.
 */
const PLANS = {
  /* The 2026-09-13 failure: the gateway answers, Postgres never sees it. */
  timeout: () => ({ code: 504, body: TIMEOUT }),

  /* The incident this script exists for: the anon key reads rows. */
  leak: (table, method) => {
    if (method === 'DELETE') return { code: 401, body: DENIED };
    if (table === 'capacity') return { code: 200, body: '[{"quarter":"2026-Q1","booked":3}]' };
    return { code: 200, body: '[{"id":"11111111-1111-1111-1111-111111111111","name":"Acme Brewing"}]' };
  },

  /* A successful anonymous delete: 204, and an empty body. */
  delete_allowed: (table, method) => {
    if (method === 'DELETE') return { code: 204, body: '' };
    if (table === 'capacity') return { code: 200, body: '[{"quarter":"2026-Q1"}]' };
    return { code: 401, body: DENIED };
  },

  /* capacity gains a column that names a client, so USING (true) stops being safe. */
  capacity_tenant: (table) => {
    if (table === 'capacity') return { code: 200, body: '[{"quarter":"2026-Q1","client_id":"abc"}]' };
    return { code: 401, body: DENIED };
  },

  /* Production as it should be. */
  locked: (table, method) => {
    if (table === 'capacity' && method === 'GET') return { code: 200, body: '[{"quarter":"2026-Q1","booked":3}]' };
    return { code: 401, body: DENIED };
  },

  /* One blip per table, then healthy — what a transient 5xx actually looks like. */
  flaky: (table, method, n) => {
    if (n === 1) return { code: 504, body: TIMEOUT };
    if (table === 'capacity' && method === 'GET') return { code: 200, body: '[{"quarter":"2026-Q1"}]' };
    return { code: 401, body: DENIED };
  },

  /* Answered, but with neither a refusal nor data. */
  renamed: (table, method) => {
    if (method === 'DELETE') return { code: 401, body: DENIED };
    if (table === 'deals') return { code: 404, body: JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }) };
    if (table === 'capacity') return { code: 200, body: '[{"quarter":"2026-Q1"}]' };
    return { code: 401, body: DENIED };
  },
};

function serve(planName) {
  const plan = PLANS[planName];
  if (!plan) { console.error('unknown plan ' + planName); process.exit(2); }
  const seen = {};
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://127.0.0.1').pathname;
    const send = (code, body, type) => {
      res.writeHead(code, { 'Content-Type': type || 'application/json' });
      res.end(body);
    };
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      // The quote form is probed by its validation message, not its status.
      if (fn === 'submit_quote_request') return send(400, JSON.stringify({ message: 'brand_name is required' }));
      return send(200, JSON.stringify({ ok: true }));
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      seen[table] = (seen[table] || 0) + 1;
      const answer = plan(table, req.method, seen[table]);
      return send(answer.code, answer.body);
    }
    return send(200, '<!doctype html><title>stub</title>', 'text/html');   // the public site
  });
  server.listen(0, '127.0.0.1', () => console.log('PORT ' + server.address().port));
}

if (process.argv[2] === '--serve') { serve(process.argv[3]); return; }

/*
 * The stub has to live in its own process: execFileSync below blocks this
 * one's event loop, so a server sharing it would never answer a request.
 */
function startStub(planName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--serve', planName], { stdio: ['ignore', 'pipe', 'inherit'] });
    const timer = setTimeout(() => reject(new Error('stub did not start')), 10000);
    child.stdout.on('data', (d) => {
      const m = /PORT (\d+)/.exec(String(d));
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    });
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error('stub exited ' + c)); });
  });
}

/* Run the real script against the stub. Section 5 is left unrequested, so the
 * exit code reflects sections 1-4 only. */
function run(port) {
  const env = {
    ...process.env,
    GL_INVARIANT_SUPA_URL: `http://127.0.0.1:${port}`,
    GL_INVARIANT_SITE_URL: `http://127.0.0.1:${port}`,
    GL_INVARIANT_ANON_KEY: 'sb_publishable_stub',
    GL_INVARIANT_SIGNUP_PROBE: '0',
    GL_INVARIANT_PROBE_BACKOFF: '0',   // keeps the retry path instant
  };
  try {
    return { code: 0, out: execFileSync('bash', [SCRIPT], { env, cwd: REPO, encoding: 'utf8', timeout: 120000 }) };
  } catch (e) {
    return { code: e.status === undefined || e.status === null ? -1 : e.status,
             out: (e.stdout || '') + (e.stderr || '') };
  }
}

async function scenario(planName) {
  const { child, port } = await startStub(planName);
  try { return run(port); }
  finally { child.kill(); }
}

(async () => {
  console.log('\nsecurity-invariants.sh — three outcomes, never two\n');

  /* ── 1. The 2026-09-13 failure, reproduced exactly ──────────────── */
  const timeout = await scenario('timeout');
  check('a gateway timeout is never reported as exposed data',
    !/ANONYMOUS DATA VISIBLE/.test(timeout.out),
    timeout.out.split('\n').filter(l => /DATA VISIBLE/.test(l)).join('\n'));
  check('a gateway timeout is reported as UNVERIFIED',
    /UNVERIFIED — deals/.test(timeout.out) && /UNVERIFIED — profiles/.test(timeout.out));
  check('a gateway timeout is never reported as a permitted anonymous delete',
    !/ANONYMOUS DELETE NOT REFUSED/.test(timeout.out));
  check('section 2b does not pass a timeout as "no tenant identifier"',
    !/carries no tenant identifier/.test(timeout.out),
    'a 504 body has no column names either — the old check read that as safe');
  check('an unreachable database still fails the run',
    timeout.code === 1, 'exit ' + timeout.code);
  check('the summary says NOT PROVEN, not VIOLATED',
    /NOT PROVEN/.test(timeout.out) && !/SECURITY INVARIANT VIOLATED/.test(timeout.out));
  check('the summary states plainly that no exposure was observed',
    /NO EXPOSURE WAS OBSERVED/.test(timeout.out));

  /* ── 2. A real leak still reads as a real leak ──────────────────── */
  const leak = await scenario('leak');
  check('rows returned to the anon key are reported as ANONYMOUS DATA VISIBLE',
    /ANONYMOUS DATA VISIBLE/.test(leak.out));
  check('a real leak fails the run',
    leak.code === 1, 'exit ' + leak.code);
  check('a real leak says VIOLATED, not NOT PROVEN',
    /SECURITY INVARIANT VIOLATED/.test(leak.out) && !/^NOT PROVEN/m.test(leak.out));
  check('a real leak tells the reader not to re-run it',
    /Do not re-run it/.test(leak.out));

  /* ── 3. A permitted anonymous delete (204, empty body) ──────────── */
  const del = await scenario('delete_allowed');
  check('a 204 with an empty body is caught as a permitted anonymous delete',
    /ANONYMOUS DELETE NOT REFUSED/.test(del.out));

  /* ── 4. capacity gaining a tenant column ────────────────────────── */
  const tenant = await scenario('capacity_tenant');
  check('a tenant-identifying column on capacity is still caught',
    /tenant-identifying column now anon-readable/.test(tenant.out));

  /* ── 5. A locked-down system passes ─────────────────────────────── */
  const locked = await scenario('locked');
  check('a locked-down system passes sections 1-4',
    locked.code === 0, 'exit ' + locked.code + '\n' + locked.out);
  check('a run without the signup probe never claims full coverage',
    /Sections 1-4 hold/.test(locked.out) && !/All security invariants hold/.test(locked.out));

  /* ── 6. A transient blip is retried rather than reported ────────── */
  const flaky = await scenario('flaky');
  check('a single gateway blip is retried and does not fail the run',
    flaky.code === 0, 'exit ' + flaky.code + '\n' + flaky.out);
  check('a retried blip leaves no UNVERIFIED line behind',
    !/UNVERIFIED —/.test(flaky.out));

  /* ── 7. A response that is neither refusal nor data ─────────────── */
  const renamed = await scenario('renamed');
  check('a 404 is UNVERIFIED, not a leak',
    /UNVERIFIED — deals/.test(renamed.out) && !/ANONYMOUS DATA VISIBLE/.test(renamed.out));
  check('a 404 still fails the run rather than passing quietly',
    renamed.code === 1, 'exit ' + renamed.code);

  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
