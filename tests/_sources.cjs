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
  // Everything under src/, in real load order. Regenerated from the actual
  // <script> tags in index.html, so it cannot drift out of order.
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
  'src/shared/notifications.js',
  'src/shared/calendar.js',
  'src/shared/tasks.js',
  'src/shared/password-change.js',
  'src/modules/invoicing/follow-up.js',
  'src/shared/ai-meeting-notes.js',
  'src/shared/ai-drafts.js',
  'src/shared/ai-chat.js',
  'src/modules/production/ai-optimizer.js',
  'src/shared/mobile-menu.js',
  'src/shared/ai-insights.js',
  'src/modules/pipeline/referrals.js',
  'src/shared/permissions.js',
  'src/shared/users-page.js',
  'src/shared/pwa-install.js',
  'src/shared/email-composer.js',
  'src/shared/correspondence.js',
  'src/modules/pipeline/deal-detail.js',
  'src/services/utils.js',
  'src/services/auth.js',
  'src/modules/invoicing/invoice-builder.js',
  'src/shared/footer-nav.js',
  'src/services/seo.js',
  'src/shared/soft-refresh.js',
  'src/modules/pipeline/scheduling.js',
  'src/modules/pipeline/calendar.js',
  'src/modules/invoicing/accounting.js',
  'src/modules/invoicing/invoice-delete.js',
  'src/modules/customers/portal.js',
  'src/modules/production/production-runs.js',
  'src/modules/production/cip-audit.js',
  'src/modules/production/compliance.js',
  'src/shared/help.js',
  'src/modules/production/compliance-ext.js',
  'src/modules/customers/portal-public.js',
  'src/services/email.js',
  'src/modules/invoicing/billing-admin.js',
  'src/modules/customers/portal-customer.js',
  'src/services/integrations.js',
  'src/modules/customers/edit-client.js',
  'src/modules/production/quality.js',
  'src/shared/help-features.js',
  'src/services/permissions-service.js',
  'src/modules/customers/requests.js',
  'src/modules/invoicing/invoice-patches.js',
  'src/modules/invoicing/pricing-settings.js',
  'src/modules/customers/client-email.js',
  'src/modules/quotes/quote-builder.js',
  'src/modules/customers/onboarding.js',
  'src/modules/production/gmp.js',
  'src/modules/customers/client-detail.js',
  'src/modules/customers/artwork.js',
  'src/modules/pipeline/deal-docs.js',
  'src/modules/pipeline/meeting-notes.js',
  'src/modules/customers/intake.js',
  'src/modules/pipeline/deal-brief.js',
  'src/modules/pipeline/attention.js',
  'src/modules/pipeline/followups.js',
  'src/modules/pipeline/booking-review.js',
  'src/modules/production/gmp-schedule.js',
  'src/modules/production/trace.js',
  'src/modules/production/training.js',
  'src/modules/pipeline/formulation.js',
  'src/modules/production/audit-review.js',
  'src/shared/selftest.js',
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
