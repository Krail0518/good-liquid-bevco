/*
 * edge-function-hardening.test.cjs — GL-007, GL-008, GL-009.
 *
 * GL-007 — four functions were verify_jwt=false in production but appeared in
 * no config file, so the setting existed only as server-side state. That works
 * until a function is recreated or the project restored, at which point it
 * comes back with the default (true) and silently starts rejecting its caller:
 * Stripe stops reconciling payments, Mailgun stops updating delivery status,
 * the public booking form stops working. The live state was read via the
 * Management API and declared, rather than inferred from the code.
 *
 * GL-008 — mailgun-webhook verified the HMAC but never checked the timestamp.
 * The signature proves Mailgun produced the payload; it does not prove Mailgun
 * produced it recently. A single captured callback stayed valid forever, so
 * anyone who ever observed one could replay it to flip an email_log row back
 * to delivered/opened/bounced — and the signature would verify every time,
 * because it is the same real signature.
 *
 * GL-009 — delete-staff-user selected only `is_super_user`. A profiles row
 * survives deactivation (status flips to 'inactive'; the row is not removed),
 * so a DEACTIVATED super-user kept the ability to hard-delete auth accounts.
 *
 * Run:  node tests/edge-function-hardening.test.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const config   = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const mailgun  = fs.readFileSync(path.join(ROOT, 'supabase/functions/mailgun-webhook/index.ts'), 'utf8');
const delUser  = fs.readFileSync(path.join(ROOT, 'supabase/functions/delete-staff-user/index.ts'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

console.log('edge functions — declared JWT state, replay window, deactivated super-user\n');

/* ── GL-007 ───────────────────────────────────────────────────────── */
for (const fn of ['stripe-webhook', 'mailgun-webhook', 'mailgun-inbound', 'booking-confirm']) {
  const re = new RegExp('\\[functions\\.' + fn + '\\][\\s\\S]{0,80}?verify_jwt = false');
  check('config declares verify_jwt=false for ' + fn, re.test(config),
    'a recreated function would come back with the default (true) and reject its caller');
}

// Declaring false for a function that does not need it would enshrine a weaker
// default than it requires.
for (const fn of ['send-sms', 'gmail-send', 'daily-digest', 'email-scheduler']) {
  check('config does NOT pin ' + fn + ' (it calls requireStaff itself)',
    !new RegExp('\\[functions\\.' + fn + '\\]').test(config));
}

/* ── GL-008 ───────────────────────────────────────────────────────── */
check('mailgun-webhook checks the callback timestamp',
  /signing\.timestamp[\s\S]{0,400}?MAX_AGE/.test(mailgun),
  'the HMAC is verified but nothing bounds how old the payload may be');

check('a non-numeric timestamp is rejected',
  /Number\.isFinite\(ts\)[\s\S]{0,120}?401/.test(mailgun));

check('a stale callback is refused with 401',
  /stale callback[\s\S]{0,40}?401/.test(mailgun));

// Rejecting before the HMAC avoids spending a constant-time comparison on
// obvious garbage, and keeps the cheap check first.
check('the freshness check runs before the signature check',
  (() => {
    const tsAt  = mailgun.indexOf('MAX_AGE');
    const sigAt = mailgun.indexOf('verifyMailgunSignature(signing.timestamp');
    return tsAt !== -1 && sigAt !== -1 && tsAt < sigAt;
  })());

/* ── GL-009 ───────────────────────────────────────────────────────── */
check('delete-staff-user reads the caller status, not just is_super_user',
  /select\('is_super_user, status'\)/.test(delUser),
  'a deactivated super-user would keep the ability to hard-delete auth accounts');

check('a deactivated caller is refused',
  /status \?\? 'active'\) === 'inactive'[\s\S]{0,120}?403/.test(delUser));

check('the super-user check is still present',
  /!callerProfile\?\.is_super_user[\s\S]{0,80}?403/.test(delUser));

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
