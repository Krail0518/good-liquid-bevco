/*
 * ai-review.mjs — run the weekly deep review and emit structured findings.
 *
 * GL-030. The workflow around this already gathered the right input and then
 * failed on purpose, because a green check with no reviewer behind it asserts
 * that a review happened. This is the reviewer.
 *
 * WHY OPENAI AND NOT ANTHROPIC
 * ----------------------------
 * AGENTS.md divides the work: Claude implements, ChatGPT/Codex reviews
 * INDEPENDENTLY. A reviewer from the same family as the implementer is not an
 * independent review, it is the same model marking its own homework. The whole
 * value of the arrangement is that the reviewer did not write the code.
 *
 * WHAT IT GUARANTEES
 * ------------------
 * The failure mode this repository keeps producing is a check that cannot
 * express failure — full-sweep scoring an undefined global as PASS (GL-033),
 * the pageerror filter discarding real crashes (GL-034), four test files that
 * were never wired to a workflow (GL-039). So:
 *
 *   - a missing API key is a hard failure, never a skip
 *   - an API error is a hard failure, never "no findings"
 *   - unparseable output is a hard failure, never an empty list
 *   - "no findings" is only ever reported when the model actually returned an
 *     empty list, and that is stated distinctly from "the review did not run"
 *
 * Exit codes:
 *   0  review ran; findings written to the output directory (possibly zero)
 *   1  the review did NOT run, or its output could not be trusted
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/ai-review.mjs <input-file> <out-dir>
 */

import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, outDir] = process.argv;

function die(msg) {
  console.error('::error::' + msg);
  process.exit(1);
}

if (!inputPath || !outDir) die('usage: ai-review.mjs <input-file> <out-dir>');

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  die(
    'OPENAI_API_KEY is not set, so no review ran. This is a failure, not a skip: ' +
    'a passing job here would assert that a weekly review happened. ' +
    'Add the secret in Settings -> Secrets and variables -> Actions.'
  );
}

const MODEL = process.env.AI_REVIEW_MODEL || 'gpt-4o';

if (!fs.existsSync(inputPath)) die('review input not found at ' + inputPath);
const reviewInput = fs.readFileSync(inputPath, 'utf8');
if (reviewInput.trim().length < 50) {
  die('review input is essentially empty (' + reviewInput.trim().length +
      ' chars) — reviewing nothing would produce a meaningless pass');
}

const ROOT = process.cwd();
const readIf = (p) => (fs.existsSync(path.join(ROOT, p))
  ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');

const promptFile = readIf('prompts/weekly-deep-review.md');
const houseRules = readIf('CLAUDE.md');

const SYSTEM = [
  'You are an independent reviewer for the Good Liquid Bev Co CRM. You did not',
  'write this code. Do not rubber-stamp it.',
  '',
  'This is a MULTI-TENANT system. The customer portal is used by competing',
  'beverage brands. One client seeing another\'s data is the worst outcome the',
  'system can produce. Supabase signup is open, so a self-registered stranger',
  'is a real attacker, not a hypothetical.',
  '',
  'Grade every finding BLOCKER / HIGH / MEDIUM / LOW / INFORMATIONAL.',
  'BLOCKER and HIGH block release.',
  '',
  'Rules for what counts as a finding:',
  '  - It must name a location: file, and line where you can.',
  '  - It must state a concrete failure scenario: what input or state produces',
  '    what wrong outcome. "Could be unsafe" is not a finding. "An RLS',
  '    rejection returns 0 rows and the UI reports success" is.',
  '  - Do not report something as broken unless the evidence in front of you',
  '    shows it. Speculation graded HIGH is worse than no review, because it',
  '    trains the owner to ignore the output.',
  '  - Reporting zero findings is an acceptable and sometimes correct result.',
  '    Do not invent findings to look useful.',
  '',
  'The house rules below came from real production incidents. Weight them.',
].join('\n');

const USER = [
  '# What to review for', '', promptFile || '(prompt file missing)', '',
  '# House rules (CLAUDE.md)', '', houseRules.slice(0, 20000), '',
  '# This week\'s input', '', reviewInput,
  '', '---', '',
  'Return JSON only, shaped exactly:',
  '{"findings":[{"id":"","severity":"","release_blocking":true,',
  '"files":[""],"explanation":"","failure_scenario":"","remediation":""}]}',
  '',
  'id: short and stable, e.g. AIR-2026-08-01. severity: one of BLOCKER, HIGH,',
  'MEDIUM, LOW, INFORMATIONAL. release_blocking: true only for BLOCKER/HIGH.',
  'Return {"findings":[]} if you genuinely found nothing.',
].join('\n');

let res;
try {
  res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER },
      ],
    }),
  });
} catch (e) {
  die('the reviewer could not be reached, so no review ran: ' + e.message);
}

if (!res.ok) {
  const body = await res.text().catch(() => '');
  die('the reviewer returned HTTP ' + res.status + ', so no review ran. ' +
      (res.status === 404 ? 'Check AI_REVIEW_MODEL — "' + MODEL + '" may not exist for this key. ' : '') +
      body.slice(0, 400));
}

const payload = await res.json();
const text = payload?.choices?.[0]?.message?.content;
if (!text) die('the reviewer returned no content, so there is nothing to trust');

let parsed;
try {
  parsed = JSON.parse(text);
} catch (e) {
  die('the reviewer\'s output was not valid JSON, so it cannot be trusted as ' +
      '"no findings": ' + text.slice(0, 300));
}

if (!Array.isArray(parsed.findings)) {
  die('the reviewer\'s output had no findings array — refusing to treat that ' +
      'as zero findings');
}

const VALID = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'];
const findings = [];
for (const [i, f] of parsed.findings.entries()) {
  const sev = String(f.severity || '').toUpperCase();
  if (!VALID.includes(sev)) {
    die('finding ' + i + ' has severity "' + f.severity + '", which is not one ' +
        'of ' + VALID.join('/') + '. Refusing to file a finding that cannot be graded.');
  }
  if (!f.failure_scenario || !String(f.failure_scenario).trim()) {
    die('finding ' + i + ' (' + (f.id || 'no id') + ') has no failure scenario. ' +
        'The template requires one, because a finding without it cannot be ' +
        'verified or refuted.');
  }
  findings.push({
    id: String(f.id || 'AIR-' + (i + 1)).trim(),
    severity: sev,
    // Trust the grade, not the model's own boolean: BLOCKER/HIGH block release
    // per the standard whatever it claims.
    release_blocking: sev === 'BLOCKER' || sev === 'HIGH',
    files: Array.isArray(f.files) ? f.files : [],
    explanation: String(f.explanation || '').trim(),
    failure_scenario: String(f.failure_scenario).trim(),
    remediation: String(f.remediation || '').trim(),
  });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'findings.json'),
  JSON.stringify({ model: MODEL, findings }, null, 2));

const blocking = findings.filter((f) => f.release_blocking).length;
console.log('review ran against ' + MODEL);
console.log('findings: ' + findings.length + ' (' + blocking + ' release-blocking)');
for (const f of findings) {
  console.log('  ' + f.severity.padEnd(14) + f.id + '  ' + (f.files[0] || ''));
}
if (findings.length === 0) {
  console.log('The reviewer returned an empty list. That is a real result, not a skip.');
}
