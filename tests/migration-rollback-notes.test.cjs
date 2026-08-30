/*
 * migration-rollback-notes.test.cjs — every NEW migration explains how to undo
 * itself.
 *
 * CLAUDE.md: "Every migration gets a ROLLBACK: note at the top." The reason is
 * specific to this project — authorization changes are applied to production
 * through the Supabase MCP, so the person undoing one at 2am is reading the
 * file, not a deployment tool's history.
 *
 * 93 of the migrations in this repository predate that rule and do not
 * carry a note. They are frozen in the list below rather than retrofitted:
 * writing a rollback for a migration nobody can test today would produce
 * confident instructions that have never been run, which is worse than an
 * honest absence.
 *
 * The list may only ever SHRINK. A new migration without a note fails, and so
 * does an entry here that has since gained one — otherwise the exemption
 * quietly becomes permission.
 *
 * Run:  node tests/migration-rollback-notes.test.cjs
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

// Frozen 2026-08-29. Predates the rule; never add to this list.
const HISTORICAL_EXEMPTIONS = new Set([
  '20260516000000_new_feature_tables.sql',
  '20260516000001_qbo_tokens.sql',
  '20260517000000_compliance_module.sql',
  '20260517000001_phase3_extras.sql',
  '20260518000000_cip_equipment.sql',
  '20260518000001_clients_additional_emails.sql',
  '20260518000002_clients_missing_columns.sql',
  '20260518000004_customer_portal.sql',
  '20260518000005_email_log_and_schedule.sql',
  '20260518000006_email_log_backfill.sql',
  '20260518000007_email_templates.sql',
  '20260518000008_invoice_share_token.sql',
  '20260518000009_invoices_delete_policy.sql',
  '20260518000010_invoices_payment_terms.sql',
  '20260518000011_link_customer_user_rpc.sql',
  '20260518000003_phase4_sql_pack.sql',
  '20260518000012_rls_authed_all.sql',
  '20260518000013_schema_gap_pack.sql',
  '20260518000014_schema_gap_pack_2.sql',
  '20260519000000_followup_acks_waivers.sql',
  '20260519000001_invoices_paid_tracking.sql',
  '20260519000003_permissions_audit.sql',
  '20260519000004_portal_rls_lockdown.sql',
  '20260519000005_realtime_invoices.sql',
  '20260519000006_security_hardening.sql',
  '20260519000007_update_customer_account_rpc.sql',
  '20260519000002_user_permissions.sql',
  '20260519000008_user_permissions_actions.sql',
  '20260520000000_auto_mark_overdue.sql',
  '20260520000001_client_pricing_overrides.sql',
  '20260520000002_customer_requests.sql',
  '20260520000003_daily_digest_cron.sql',
  '20260520000004_lot_documents.sql',
  '20260520000005_notification_opt_outs.sql',
  '20260520000006_portal_multiuser.sql',
  '20260520000007_production_scheduling.sql',
  '20260520000008_run_stage_emails.sql',
  '20260520000009_sms_reminders.sql',
  '20260521000000_error_log_table.sql',
  '20260521000001_profiles_autocreate_on_signup.sql',
  '20260521000002_sample_shipments_updated_at.sql',
  '20260522000000_profiles_updated_at.sql',
  '20260523000000_activities_calendar_pipeline_paylinks.sql',
  '20260523000001_announcements_notifications_tables.sql',
  '20260523000002_client_notes_table.sql',
  '20260523000003_documents_inventory_clienttags.sql',
  '20260523000004_email_log_schedule_rls_lockdown.sql',
  '20260523000005_inspector_mode_server_side.sql',
  '20260523000006_inspector_tokens_rls_lockdown.sql',
  '20260523000007_lock_critical_tables_delete.sql',
  '20260523000008_lock_remaining_tables_delete.sql',
  '20260523000009_permission_tables_super_only.sql',
  '20260523000010_super_user_rls_enforcement.sql',
  '20260523000011_tasks_table.sql',
  '20260523000012_time_entries_table.sql',
  '20260524000000_contact_submissions_table.sql',
  '20260524000001_deals_outcome_fields.sql',
  '20260524000002_deals_quote_fields.sql',
  '20260524000003_login_events_table.sql',
  '20260525000000_deals_outreach_status.sql',
  '20260525000001_security_hardening.sql',
  '20260529000000_company_docs.sql',
  '20260529000001_deals_stage_entered_at.sql',
  '20260529000002_login_events.sql',
  '20260529000003_scheduling.sql',
  '20260530000000_booking_blocked_slots.sql',
  '20260531000000_accounting_enhancements.sql',
  '20260623000000_lock_invoices_delete.sql',
  '20260706000000_email_log_client_id.sql',
  '20260706000001_email_log_inbound.sql',
  '20260713000000_quotes_table.sql',
  '20260721000000_tour_alerts.sql',
  '20260725000000_security_audit_hardening.sql',
  '20260729000629_cron_secret_vault_and_health.sql',
  '20260729020000_cron_review_fixes.sql',
  '20260730001000_notify_trigger_auth.sql',
  '20260730002000_rotate_notify_secret.sql',
  '20260730010000_is_staff_user_profile_wins.sql',
  '20260730020000_onboarding.sql',
  '20260730030000_onboarding_token_fix.sql',
  '20260730040000_gmp_logging.sql',
  '20260730050000_gmp_documents.sql',
  '20260730060000_supplier_ncr_upgrade.sql',
  '20260730070000_phase3_wave1.sql',
  '20260730080000_phase3_wave2.sql',
  '20260731000000_client_docs_bucket.sql',
  '20260731020000_client_artwork.sql',
  '20260731030000_gmp_prp.sql',
  '20260806000000_deal_documents.sql',
  '20260806100000_no_staff_profile_for_portal_customers.sql',
  '20260807000000_portal_agreement_uploads.sql',
  '20260807010000_revoke_anonymous_database_access.sql',
  '20260807040000_audit_followups.sql',
]);

console.log('migration rollback notes\n');

const all = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const without = all.filter((f) => !fs.readFileSync(path.join(DIR, f), 'utf8').includes('ROLLBACK:'));

const newMissing = without.filter((f) => !HISTORICAL_EXEMPTIONS.has(f));
check('every new migration carries a ROLLBACK: note',
  newMissing.length === 0,
  newMissing.join(', ') +
  '\n          Add a ROLLBACK: note at the top saying how to undo it. ' +
  'Authorization changes reach production through the MCP, so this file is ' +
  'what someone reads when they need to reverse it.');

// An exemption that has since gained a note must leave the list, or the list
// stops describing reality and starts granting permission.
const staleExemptions = [...HISTORICAL_EXEMPTIONS].filter((f) => !without.includes(f));
check('no exemption is stale',
  staleExemptions.length === 0,
  staleExemptions.join(', ') + ' now has a note — remove it from HISTORICAL_EXEMPTIONS');

// And the list may not grow.
check('the exemption list has not grown',
  HISTORICAL_EXEMPTIONS.size <= 93,
  'it was 93 when frozen; exemptions may only be removed');

console.log('');
console.log('  migrations total      : ' + all.length);
console.log('  with a ROLLBACK note  : ' + (all.length - without.length));
console.log('  historical exemptions : ' + HISTORICAL_EXEMPTIONS.size);

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
