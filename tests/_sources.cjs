/*
 * _sources.cjs — where "the index.html code" lives, for tests that assert on it.
 *
 * WHY THIS EXISTS
 * ---------------
 * index.html used to carry a single ~9,300-line inline <script>. GL-037 moved
 * it verbatim into crm-index-core.js, and five test files that read
 * index.html directly went red — not because anything broke, but because they
 * had the file path baked in as a stand-in for "the CRM's core code".
 *
 * GL-037 continues by pulling capabilities out of crm-index-core.js one at a
 * time, so that will keep happening unless the tests stop naming files. This
 * helper is the indirection: ask for the body of code, not for a path.
 *
 * indexCore() returns index.html plus every file the inline block has been
 * extracted into, concatenated. Assertions written against the old inline
 * block keep meaning what they meant, wherever the code has since moved.
 *
 * When the next capability is extracted, add its filename to CORE_FILES and
 * every test that uses this keeps passing. That is the whole point.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// index.html first, then the files its inline script has been extracted into,
// in load order. Load order matters: some assertions check that one thing
// appears before another.
const CORE_FILES = [
  'index.html',
  'crm-index-core.js',
  // Extracted capabilities, in load order. Regenerated from the actual
  // <script> tags in index.html, so it cannot drift.
  'src/modules/invoicing/ar-aging.js',
  'src/modules/invoicing/pay-link.js',
  'src/modules/customers/client-notes.js',
  'src/modules/customers/tags.js',
  'src/modules/customers/email-templates.js',
  'src/modules/production/time-report.js',
  'src/modules/customers/document-storage.js',
  'src/modules/pipeline/revenue-forecast.js',
  'src/modules/pipeline/stale-deals.js',
  'src/modules/pipeline/multi-pipeline.js',
  'src/modules/customers/health-score.js',
  'src/modules/customers/health-score-ai.js',
  'src/modules/production/time-tracking.js',
  'src/modules/production/tour-booking.js',
  'src/modules/shared/notifications.js',
  'src/modules/shared/calendar.js',
  'src/modules/shared/tasks.js',
  'src/modules/shared/password-change.js',
  'src/modules/invoicing/follow-up.js',
  'src/modules/shared/ai-meeting-notes.js',
  'src/modules/shared/ai-drafts.js',
  'src/modules/shared/ai-chat.js',
  'src/modules/production/ai-optimizer.js',
  'src/modules/shared/mobile-menu.js',
  'src/modules/shared/ai-insights.js',
  'src/modules/pipeline/referrals.js',
  'src/modules/shared/permissions.js',
  'src/modules/shared/users-page.js',
  'src/modules/shared/pwa-install.js',
  'src/modules/shared/email-composer.js',
  'src/modules/shared/correspondence.js',
  'src/modules/pipeline/deal-detail.js',
];

function read(f) {
  return fs.readFileSync(path.join(ROOT, f), 'utf8');
}

/** The markup and the core script together — what index.html used to be. */
function indexCore() {
  return CORE_FILES.map(read).join('\n');
}

/** Just the core script, for assertions about JS that must not match markup. */
function coreScript() {
  return CORE_FILES.filter((f) => f.endsWith('.js')).map(read).join('\n');
}

module.exports = { ROOT, CORE_FILES, read, indexCore, coreScript };
