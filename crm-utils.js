/* crm-utils.js — Timezone-naive date formatter, password policy, currency formatter, super-user check */
(function(){
  'use strict';

  /* ── Timezone-naive date formatter ──
     `new Date("2026-05-20")` parses YYYY-MM-DD as UTC midnight, so any timezone
     west of UTC renders the PREVIOUS day. Caught when a Florida-scheduled
     2026-05-20 run displayed "May 19" in the kanban + clients page + run sheet.
     Use window.fmtLocalDate(s, opts) for any date column persisted as a bare
     ISO date string. Accepts the same options object as toLocaleDateString. */
  window.fmtLocalDate = window.fmtLocalDate || function(s, opts){
    if(!s) return '';
    var str = String(s);
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(str);
    return d.toLocaleDateString('en-US', opts);
  };

  /* ── Password policy helper ──
     Org-wide rule (set by Mike on 2026-05-22): minimum 8 characters,
     at least one uppercase letter, at least one special character.
     Returns null when the password is acceptable, otherwise an English
     error message ready to display.
     The error message is intentionally specific so users can see which
     rule they tripped — vague "password is invalid" messages just lead
     to support tickets. */
  window.GL_PW_MIN_LEN = 8;
  window.GL_PW_SPECIAL_RE = /[^A-Za-z0-9]/;
  window.GL_PW_UPPER_RE = /[A-Z]/;
  window.glValidatePassword = window.glValidatePassword || function(pw){
    pw = String(pw == null ? '' : pw);
    if(pw.length < window.GL_PW_MIN_LEN){
      return 'Password must be at least ' + window.GL_PW_MIN_LEN + ' characters.';
    }
    if(!window.GL_PW_UPPER_RE.test(pw)){
      return 'Password must include at least one capital letter (A–Z).';
    }
    if(!window.GL_PW_SPECIAL_RE.test(pw)){
      return 'Password must include at least one special character (e.g. !@#$%^&*).';
    }
    return null;
  };

  /* ── Compliant temporary password generator ──
     Produces a passphrase that satisfies window.glValidatePassword() by
     construction (always 12 chars, at least one uppercase, one lowercase,
     one digit, one special). Used when an admin invites a new staff or
     customer user and the system needs to seed a password they'll
     immediately reset. The old GL+6-random generator only sometimes hit
     the policy. */
  window.glGenerateTempPassword = window.glGenerateTempPassword || function(){
    var UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var LO = 'abcdefghjkmnpqrstuvwxyz';
    var DG = '23456789';
    var SP = '!@#$%^&*';
    function pick(s){ return s[Math.floor(Math.random()*s.length)]; }
    // Guarantee one of each class so policy is always met.
    var out = [pick(UP), pick(LO), pick(DG), pick(SP)];
    var pool = UP + LO + DG + SP;
    while(out.length < 12) out.push(pick(pool));
    // Shuffle so the guaranteed chars aren't always in positions 0..3.
    for(var i = out.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out.join('');
  };

  /* ── USD currency formatter with enforced two-decimal precision ──
     Plain `.toLocaleString()` on a number drops trailing fractional zeros
     ($2,312.50 → "$2,312.5") which looks like a glitch on every invoice,
     KPI tile, and total line. Use window.fmtUsd(n) anywhere a dollar
     amount is shown to a user. Returns the bare numeric string — caller
     prepends the '$'. */
  window.fmtUsd = window.fmtUsd || function(n){
    return Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  /* ── Super-user check ──
     UI gate that hides destructive buttons (Delete client, Remove
     user, etc.) for non-super admins. The server-side enforcement
     lives in 20260523_super_user_rls_enforcement.sql — RLS policies
     consult public.is_super_user() which reads profiles.is_super_user
     for the calling user, so a DevTools call bypassing this UI
     check still bounces at the database. This JS function is
     purely cosmetic now; the security boundary is the DB.

     Reads profiles.is_super_user from currentUser when available
     (post-migration). Falls back to the hardcoded owner email so
     the gate works against deployments that haven't applied the
     migration yet. */
  /* ── HTML escaping — canonical implementation ──
     All crm-*.js modules that previously defined a local esc() function
     now alias this. Escapes the 5 characters that produce XSS when
     user-controlled strings are interpolated into innerHTML templates.
     Call as: var esc = window.glEsc; inside any IIFE that needs it. */
  window.glEsc = window.glEsc || function(s){
    if(s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  };

  window.GL_SUPER_USER_EMAIL = 'mike@goodliquid.com';
  window.glIsSuperUser = window.glIsSuperUser || function(){
    var u = window.currentUser;
    if(!u) return false;
    if(u.is_super_user === true) return true;            // canonical
    if(u.is_super_user === false) return false;          // explicitly not super
    // Field absent (migration not applied yet) — fall back to email.
    return String(u.email||'').toLowerCase() === window.GL_SUPER_USER_EMAIL;
  };

}());
