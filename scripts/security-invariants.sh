#!/usr/bin/env bash
# ============================================================
# security-invariants.sh — assert the things that must never be true again
# ============================================================
# Born from the 2026-08-06 audit, which found that ANY internet user could
# read, edit and delete the entire CRM: fourteen tables carried a policy
# granting the `anon` role unrestricted access, and the publishable key that
# unlocks it ships in the page source by design.
#
# That hole survived months of code review for one reason: the policies were
# applied by hand in the Supabase dashboard, so they existed in NO migration
# file. Reading the repo could never have found them. This script therefore
# tests the LIVE SYSTEM from the outside, exactly as an attacker would.
#
# It needs no secrets — only the publishable key, which is public by design.
# That is the point: if this script can read your data, so can anyone.
#
# Usage:  bash scripts/security-invariants.sh
# Exit 0 = all invariants hold. Exit 1 = something regressed.

set -uo pipefail

SUPA="https://ufjkeqmxwuyhbqyugcgg.supabase.co"
ANON="sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB"
SITE="https://www.goodliquidbevco.com"
FAILED=0

pass(){ printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }

echo
echo "── 1. No anonymous access to business data ───────────────────"
# Every one of these was world-readable AND world-writable before the audit.
for t in clients invoices deals quotes profiles customer_users onboarding \
         expenses audit_log invoice_payments client_notes client_rate_overrides \
         formulas vendors production_runs sample_shipments referrals referrers \
         trade_shows content_calendar yield_logs defects company_docs qbo_tokens; do
  body=$(curl -s --max-time 20 "$SUPA/rest/v1/$t?select=*&limit=1" -H "apikey: $ANON")
  # Acceptable: permission denied (42501), or an empty set (RLS filtered all rows).
  if echo "$body" | grep -q '42501'; then
    pass "$t — permission denied"
  elif [ "$body" = "[]" ]; then
    pass "$t — no rows visible"
  else
    fail "$t — ANONYMOUS DATA VISIBLE: $(echo "$body" | head -c 120)"
  fi
done

echo
echo "── 2. No anonymous writes ────────────────────────────────────"
for t in clients invoices deals; do
  body=$(curl -s --max-time 20 -X DELETE "$SUPA/rest/v1/$t?id=neq.00000000-0000-0000-0000-000000000000" -H "apikey: $ANON")
  if echo "$body" | grep -q '42501'; then
    pass "$t — delete refused"
  else
    fail "$t — ANONYMOUS DELETE NOT REFUSED: $(echo "$body" | head -c 120)"
  fi
done

echo
echo "── 3. The public surface still works ─────────────────────────"
# These SHOULD be reachable anonymously — the portal and public pages depend
# on them. A failure here means a lockdown went too far and broke customers.
code=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$SUPA/rest/v1/rpc/get_shared_invoice" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p_token":"probe"}')
[ "$code" = "200" ] && pass "public invoice links (get_shared_invoice)" \
                    || fail "public invoice links broken — HTTP $code"

code=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$SUPA/rest/v1/rpc/gl_onboarding_get" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p_token":"probe"}')
[ "$code" = "200" ] && pass "client onboarding page (gl_onboarding_get)" \
                    || fail "onboarding page broken — HTTP $code"

# Probed with an EMPTY payload so it validates and rejects without creating a
# deal — reachability without side effects.
body=$(curl -s --max-time 20 -X POST "$SUPA/rest/v1/rpc/submit_quote_request" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p":{}}')
echo "$body" | grep -q 'brand_name is required' \
  && pass "public quote form (submit_quote_request)" \
  || fail "quote form unreachable or changed: $(echo "$body" | head -c 120)"

for p in "/" "/?portal=1" "/onboard.html"; do
  code=$(curl -sL --max-time 25 -o /dev/null -w '%{http_code}' "$SITE$p")
  [ "$code" = "200" ] && pass "page $p" || fail "page $p — HTTP $code"
done

echo
echo "── 4. No secrets in shipped code ─────────────────────────────"
# Scoped to git-TRACKED browser files: those are what actually ship. Scanning
# the working tree instead would flag scratch dirs and tooling, and a check
# that cries wolf gets ignored — which is how the real hole survived.
# supabase/functions/* legitimately read service-role keys from the
# environment; they run server-side and are never sent to a browser.
shipped=$(git ls-files '*.js' '*.html' 2>/dev/null | grep -v -e '^supabase/functions/' -e '^crm-help')

hits=$(printf '%s\n' "$shipped" | xargs -r grep -lE \
        'service_role|SUPABASE_SERVICE_ROLE_KEY *= *["'"'"'][A-Za-z0-9]|sk_live_[A-Za-z0-9]{10,}' \
        2>/dev/null || true)
[ -z "$hits" ] && pass "no service-role or live secret keys in shipped files" \
               || fail "possible secret in: $hits"

# The legacy long-lived anon JWT that was hardcoded in three modules.
hits=$(printf '%s\n' "$shipped" | xargs -r grep -l 'eyJhbGciOiJIUzI1NiIs' 2>/dev/null || true)
[ -z "$hits" ] && pass "no hardcoded JWT-format keys" \
               || fail "hardcoded JWT key in: $hits"

echo
echo "── 5. A self-registered stranger is not staff ────────────────"
# Sections 1-4 only ever authenticate as `anon`. That is one of the three
# identities CLAUDE.md says to test, and it is not the one that failed on
# 2026-08-28: handle_new_user() was a denylist, so ANY bare signup received an
# active 'sales' profiles row. An active profiles row IS is_gl_staff(), which
# cleared the tenant guard and reached the legacy "authed all" USING(true)
# policies — full CRUD on every table. An anon-only probe cannot see that at
# all, which is why the hole survived a script written to catch exactly this
# class of bug.
#
# This section signs up a throwaway account and asserts it is nobody: no
# profiles row, and no readable business data.
#
# It creates a real auth.users row, so it is OPT-IN. The workflow enables it on
# the daily run and on manual dispatch, not on every pull request, so probe
# accounts accrue at about one per day rather than one per push. They carry no
# profile and no customer_users link, so they are inert — but sweep them
# occasionally:
#   delete from auth.users where email like 'invariant-probe-%@example.invalid';
if [ "${GL_INVARIANT_SIGNUP_PROBE:-0}" != "1" ]; then
  printf '  \033[33mskip\033[0m %s\n' "signup probe (set GL_INVARIANT_SIGNUP_PROBE=1 to run)"
else
  # jq is present on GitHub runners but not always in Git Bash; fall back to sed.
  jget(){ if command -v jq >/dev/null 2>&1; then jq -r "$2 // empty" <<<"$1"
          else sed -n "s/.*\"${2##*.}\":\"\([^\"]*\)\".*/\1/p" <<<"$1" | head -1; fi; }

  probe_email="invariant-probe-$(date +%s)-$RANDOM@example.invalid"
  probe_pw="Pr0be-$RANDOM-$RANDOM-Aa!"
  signup=$(curl -s --max-time 25 -X POST "$SUPA/auth/v1/signup" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$probe_email\",\"password\":\"$probe_pw\"}")

  tok=$(jget "$signup" '.access_token')
  uid=$(jget "$signup" '.user.id')
  [ -z "$uid" ] && uid=$(jget "$signup" '.id')

  if echo "$signup" | grep -qi 'signup_disabled\|signups not allowed'; then
    pass "signup is disabled entirely — nobody can self-register"
  elif [ -z "$tok" ]; then
    # No session means email confirmation is on — the state of this project as
    # of 2026-08-28. The account IS created and the trigger HAS already run, so
    # the profile question is decided; we simply have no JWT to ask with, and
    # anon cannot read profiles. The invariant is therefore not checkable from
    # outside without a secret, and this reports a skip rather than a pass.
    #
    # Note confirmation is a speed bump, not the control: any disposable inbox
    # clears it. The allowlist in handle_new_user() is what actually holds.
    printf '  \033[33mskip\033[0m %s\n' "email confirmation is on — no session, so the profile cannot be probed externally"
    echo "         account created: $probe_email"
    echo "         verify it received no staff profile, and clean up, with:"
    echo "           select u.email, (select count(*) from public.profiles p where p.id=u.id) as profile_rows"
    echo "             from auth.users u where u.email = '$probe_email';"
    echo "           delete from auth.users where email like 'invariant-probe-%@example.invalid';"
  else
    auth=(-H "apikey: $ANON" -H "Authorization: Bearer $tok")

    # THE invariant. If this fails, a stranger is staff.
    body=$(curl -s --max-time 20 "$SUPA/rest/v1/profiles?id=eq.$uid&select=id,role,status" "${auth[@]}")
    if [ "$body" = "[]" ] || echo "$body" | grep -q '42501'; then
      pass "self-signup received NO staff profile"
    else
      fail "SELF-SIGNUP GOT A STAFF PROFILE: $(echo "$body" | head -c 160)"
    fi

    # Even without a profile, confirm the data is actually unreachable.
    for t in clients invoices formulas lot_documents customer_users; do
      body=$(curl -s --max-time 20 "$SUPA/rest/v1/$t?select=*&limit=1" "${auth[@]}")
      if echo "$body" | grep -q '42501'; then
        pass "$t — permission denied to a self-registered account"
      elif [ "$body" = "[]" ]; then
        pass "$t — no rows visible to a self-registered account"
      else
        fail "$t — VISIBLE TO A SELF-REGISTERED ACCOUNT: $(echo "$body" | head -c 160)"
      fi
    done

    body=$(curl -s --max-time 20 -X DELETE \
      "$SUPA/rest/v1/clients?id=neq.00000000-0000-0000-0000-000000000000" "${auth[@]}")
    if echo "$body" | grep -q '42501' || [ "$body" = "[]" ]; then
      pass "clients — delete refused for a self-registered account"
    else
      fail "SELF-REGISTERED DELETE NOT REFUSED: $(echo "$body" | head -c 160)"
    fi

    echo "         probe account: $probe_email"
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "All security invariants hold."
else
  echo "SECURITY INVARIANT VIOLATED — see failures above."
  echo "If a lockdown broke a public flow, each supabase/migrations/2026080*.sql"
  echo "file carries a rollback note at the top."
fi
exit "$FAILED"
