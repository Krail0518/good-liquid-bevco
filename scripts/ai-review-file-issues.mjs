/*
 * ai-review-file-issues.mjs — turn reviewer findings into GitHub issues.
 *
 * GL-030, second half. Setup Instruction #1 requires findings to land in a
 * predictable location carrying six fields: id, severity, affected files,
 * explanation, recommended remediation, and release-blocking status. That
 * location is a GitHub issue shaped like
 * .github/ISSUE_TEMPLATE/ai-review-finding.md.
 *
 * DEDUPLICATION
 * -------------
 * The review runs weekly against a rolling window, so a finding that has not
 * been fixed yet will be reported again. Filing it again each week would bury
 * the remediation history and train the owner to ignore the label. An issue is
 * therefore created only when no OPEN issue already carries that finding id.
 * A recurring finding gets a comment on the existing issue instead, which is
 * the useful signal: "still present as of this run".
 *
 * Requires: GH_TOKEN, GITHUB_REPOSITORY.
 *
 * Usage: node scripts/ai-review-file-issues.mjs <findings.json>
 */

import fs from 'node:fs';

const [, , findingsPath] = process.argv;

function die(msg) { console.error('::error::' + msg); process.exit(1); }

if (!findingsPath) die('usage: ai-review-file-issues.mjs <findings.json>');
if (!fs.existsSync(findingsPath)) die('findings file not found: ' + findingsPath);

const token = process.env.GH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token) die('GH_TOKEN is not set — findings cannot be filed');
if (!repo) die('GITHUB_REPOSITORY is not set');

const { findings, model, provider, independent } = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
// Stated on every issue. A reader should never have to guess whether the
// finding came from a reviewer that also wrote the code.
const INDEP_NOTE = independent === false
  ? ' — **same model family as the implementer**, so this is not an independent review'
  : '';
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';

const api = async (method, url, body) => {
  const r = await fetch('https://api.github.com' + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) die('GitHub API ' + method + ' ' + url + ' -> ' + r.status + ' ' +
                 (await r.text().catch(() => '')).slice(0, 300));
  return r.json();
};

if (findings.length === 0) {
  console.log('No findings to file. The reviewer returned an empty list.');
  process.exit(0);
}

const open = await api('GET', `/repos/${repo}/issues?state=open&labels=ai-review&per_page=100`);
const existing = new Map();
for (const iss of open) {
  const m = /\[AI REVIEW\]\s*([A-Za-z0-9._-]+)/.exec(iss.title || '');
  if (m) existing.set(m[1], iss.number);
}

const sevBox = (sev, want) => (sev === want ? '[x]' : '[ ]');

let created = 0, recurring = 0;
for (const f of findings) {
  const prior = existing.get(f.id);
  if (prior) {
    await api('POST', `/repos/${repo}/issues/${prior}/comments`, {
      body: [
        '**Still present** as of the weekly review' + (runUrl ? ' ([run](' + runUrl + '))' : '') + '.',
        '',
        'Reported again by `' + model + '`. Severity this run: **' + f.severity + '**.',
        '',
        'Filing a second issue would bury the remediation history on this one,',
        'so this is a comment instead.',
      ].join('\n'),
    });
    recurring++;
    console.log('  recurring  ' + f.id + ' -> #' + prior);
    continue;
  }

  const body = [
    '<!-- Filed automatically by the weekly AI review (GL-030). -->',
    '',
    '## Finding ID', '', f.id, '',
    '## Severity', '',
    '- ' + sevBox(f.severity, 'BLOCKER') + ' BLOCKER — data loss, security hole, or breaks production',
    '- ' + sevBox(f.severity, 'HIGH') + ' HIGH — release-blocking defect or standard violation with real impact',
    '- ' + sevBox(f.severity, 'MEDIUM') + ' MEDIUM — technical debt, real but not urgent',
    '- ' + sevBox(f.severity, 'LOW') + ' LOW — hygiene',
    '- ' + sevBox(f.severity, 'INFORMATIONAL') + ' INFORMATIONAL — no action required',
    '',
    '## Release-blocking', '',
    '- ' + (f.release_blocking ? '[x]' : '[ ]') + ' **Blocks release** — must be fixed or explicitly accepted before merge',
    '- ' + (f.release_blocking ? '[ ]' : '[x]') + ' Does not block release',
    '',
    '## Module / affected files', '',
    f.files.length ? f.files.map((x) => '- `' + x + '`').join('\n') : '_(none given — see explanation)_',
    '',
    '## Explanation', '', f.explanation || '_(none given)_', '',
    '## Failure scenario', '', f.failure_scenario, '',
    '## Recommended remediation', '', f.remediation || '_(none given)_', '',
    '---', '',
    '## Remediation (filled in by Claude)', '',
    '**Commit SHA:**', '', '**What changed:**', '',
    '**Test that fails against the pre-fix code:**',
    '<!-- A test that passes both before and after proves nothing. State both',
    '     numbers, e.g. "18 pass on the branch, 6 fail against origin/main". -->',
    '', '**Not verified:**', '',
    '---', '',
    '## Re-review verdict', '',
    '- [ ] RESOLVED', '- [ ] STILL PRESENT', '- [ ] ACCEPTED (owner accepted the risk)',
    '', '---', '',
    '_Reviewer: `' + model + '`' + INDEP_NOTE + (runUrl ? ' · [run](' + runUrl + ')' : '') + '_',
    '',
    '_Per Setup Instruction #2 a finding must be **fixed or explicitly accepted**.',
    'Closing it to make the review pass is not remediation._',
  ].join('\n');

  const labels = ['ai-review', 'severity:' + f.severity.toLowerCase()];
  if (f.release_blocking) labels.push('release-blocking');

  const issue = await api('POST', `/repos/${repo}/issues`, {
    title: '[AI REVIEW] ' + f.id + ' — ' + f.severity + ': ' +
           (f.explanation || f.failure_scenario).slice(0, 90),
    body,
    labels,
  });
  created++;
  console.log('  created    ' + f.id + ' -> #' + issue.number);
}

console.log('\nfiled ' + created + ' new, ' + recurring + ' recurring');

const blocking = findings.filter((f) => f.release_blocking);
if (blocking.length) {
  console.log('::warning::' + blocking.length + ' release-blocking finding(s): ' +
              blocking.map((f) => f.id).join(', '));
}
