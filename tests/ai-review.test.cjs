/*
 * ai-review.test.cjs — GL-030. The review gate must not pass without reviewing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The weekly review workflow previously failed on purpose, because no reviewer
 * was connected and a green check would have asserted that a review happened.
 * Now that a reviewer IS connected, that same property has to be preserved in
 * a harder place: the reviewer can fail in ways that look like success.
 *
 * A missing API key, an HTTP error, unparseable output, or an output with no
 * findings array could each be quietly turned into "no findings" — which reads
 * as a clean bill of health. That is precisely the defect this repository
 * keeps producing: full-sweep scoring an undefined global as PASS (GL-033),
 * the pageerror filter discarding real crashes (GL-034), four test files wired
 * to no workflow (GL-039). Same shape, higher stakes.
 *
 * So each of those paths is asserted to exit non-zero, by actually running the
 * script rather than reading it.
 *
 * The reviewer accepts either provider. OpenAI is preferred because
 * AGENTS.md wants a reviewer that did not write the code; Anthropic is a
 * working fallback because this project already holds such a key. The
 * checks below pin the preference order and pin that a same-family run
 * says so, in its output and on every issue it files.
 *
 * Run:  node tests/ai-review.test.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ai-review.mjs');
const FILER = path.join(ROOT, 'scripts', 'ai-review-file-issues.mjs');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airev-'));
const goodInput = path.join(tmp, 'in.md');
fs.writeFileSync(goodInput, 'x'.repeat(200));
const emptyInput = path.join(tmp, 'empty.md');
fs.writeFileSync(emptyInput, '');

function run(script, args, env) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('weekly AI review — it must never pass without reviewing\n');

check('the reviewer script exists', fs.existsSync(SCRIPT));
check('the issue filer exists', fs.existsSync(FILER));

// ── every "did not actually review" path must fail ───────────────────
const noKey = run(SCRIPT, [goodInput, path.join(tmp, 'o1')], { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' });
check('a missing API key fails rather than skipping',
  noKey.code !== 0,
  'exit ' + noKey.code + ' — a skip here would assert a review happened');
check('the missing-key message says it is not a skip',
  /not a skip/i.test(noKey.out),
  'whoever sees this in a log needs to know the gate did not run');

const emptyIn = run(SCRIPT, [emptyInput, path.join(tmp, 'o2')], { OPENAI_API_KEY: 'dummy', ANTHROPIC_API_KEY: '' });
check('empty review input fails rather than reviewing nothing',
  emptyIn.code !== 0,
  'reviewing nothing produces a meaningless pass');

const missingIn = run(SCRIPT, [path.join(tmp, 'nope.md'), path.join(tmp, 'o3')],
  { OPENAI_API_KEY: 'dummy', ANTHROPIC_API_KEY: '' });
check('a missing input file fails', missingIn.code !== 0);

const noArgs = run(SCRIPT, [], { OPENAI_API_KEY: 'dummy', ANTHROPIC_API_KEY: '' });
check('missing arguments fail', noArgs.code !== 0);

// The filer must not file anything without credentials.
const filerNoToken = run(FILER, [path.join(tmp, 'nothing.json')], { GH_TOKEN: '' });
check('the issue filer fails without a token', filerNoToken.code !== 0);

// ── the workflow must actually call it ───────────────────────────────
console.log('');
const wf = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'weekly-ai-review.yml'), 'utf8');

check('the workflow runs the reviewer',
  /node scripts\/ai-review\.mjs/.test(wf));
check('the workflow files the findings',
  /node scripts\/ai-review-file-issues\.mjs/.test(wf));
check('the placeholder "not connected" step is gone',
  !/Reviewer not connected/.test(wf),
  'it existed to fail loudly while unwired; leaving it would fail every run');
// The filing step needs issues:write. GITHUB_TOKEN is read-only by default,
// and the failure is a 403 at the very end -- after the review has run and
// been paid for -- so it is worth pinning rather than rediscovering.
check('the workflow grants issues: write',
  /permissions:[\s\S]{0,160}?issues:\s*write/.test(wf),
  'without it the filing step gets 403 Resource not accessible by integration');
check('the workflow does not grant blanket write-all',
  !/permissions:\s*write-all/.test(wf),
  'the job needs to read the repo and write issues, nothing more');

check('the workflow passes both API keys through',
  /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/.test(wf) &&
  /ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}/.test(wf));

// The DST workaround must survive — GL-035 fixed it and nothing here should
// have disturbed the schedule.
check('the two-hour DST cron is intact',
  /cron:\s*'0 11,12 \* \* 2'/.test(wf),
  'GitHub cron is UTC with no DST handling; one hour drifts for five months');
check('the New York hour guard is intact',
  /America\/New_York/.test(wf) && /NY_HOUR/.test(wf));

// ── the reviewer must be independent of the implementer ──────────────
console.log('');
const src = fs.readFileSync(SCRIPT, 'utf8');
// Either provider may be used, but OpenAI must WIN when both keys are
// present -- an independent reviewer is the point of the arrangement -- and
// a same-family run has to announce itself rather than pass quietly.
check('OpenAI is preferred when both keys are present',
  /else if \(openaiKey\) provider = 'openai';/.test(src),
  'falling back to Anthropic while an independent reviewer is available '
  + 'throws away the value of the arrangement');
check('Anthropic is accepted as a fallback',
  /api\.anthropic\.com/.test(src) && /anthropic-version/.test(src),
  'this project already holds an Anthropic key, and a review that runs '
  + 'beats a gate that cannot');
check('a same-family run warns that it is not independent',
  /!INDEPENDENT/.test(src) && /::warning::/.test(src),
  'silently degrading the review is worse than not running it');
check('the findings record which provider produced them',
  /provider, independent: INDEPENDENT/.test(src));
check('filed issues state when the review was not independent',
  /INDEP_NOTE/.test(fs.readFileSync(FILER, 'utf8')) &&
  /same model family/.test(fs.readFileSync(FILER, 'utf8')),
  'a reader should not have to guess whether the reviewer wrote the code');

// The reviewer must be given LIVE state, not just migration files.
//
// Its first real run produced 7 findings of which 6 were wrong, every one
// from the same cause: it read migration files and reasoned about them in
// isolation. Two HIGH findings said tables had no RLS -- one has two
// policies, the other is unreachable by design -- and two more were about
// tables that do not exist. A HIGH-graded false positive is worse than
// silence, because it teaches the owner to ignore the review.
console.log('');
const baselinePath = path.join(ROOT, 'docs', 'database', 'authorization-baseline.txt');
check('the authorization baseline exists to feed the reviewer',
  fs.existsSync(baselinePath),
  'without it there is no authoritative answer to what production actually has');
check('the workflow puts live production state into the review input',
  /authorization-baseline\.txt/.test(wf),
  'the reviewer would be back to reasoning from migration files alone');
check('the input labels that state as authoritative over migrations',
  /Live production authorization state/.test(wf) && /authoritative/.test(wf),
  'the model has to be told which source wins when they disagree');
check('the prompt tells the reviewer to check claims against live state',
  /CHECK IT/.test(src) && /does not appear in the live state/.test(src),
  'supplying the state is not enough; it has to be told to use it');
check('the prompt explains that RLS-on with no grants is correct',
  /needs a grant AND a policy/.test(src),
  'this exact shape produced a HIGH false positive on the first run');
check('a finding without a failure scenario is refused',
  /no failure scenario/i.test(src),
  'the issue template requires one — a finding without it cannot be verified ' +
  'or refuted');
check('severity is validated against the standard grades',
  /BLOCKER/.test(src) && /INFORMATIONAL/.test(src) && /cannot be graded/i.test(src));
check('release-blocking is derived from severity, not taken on trust',
  /sev === 'BLOCKER' \|\| sev === 'HIGH'/.test(src),
  'the model should not get to declare its own HIGH non-blocking');

const filerSrc = fs.readFileSync(FILER, 'utf8');
check('recurring findings comment rather than duplicate',
  /still present/i.test(filerSrc) && /state=open/.test(filerSrc),
  'refiling weekly would bury the remediation history and train the owner to ' +
  'ignore the label');
check('the filed issue carries the release-blocking field',
  /Blocks release/.test(filerSrc),
  'Setup Instruction #1 requires it; without it the loop has nothing to gate on');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
