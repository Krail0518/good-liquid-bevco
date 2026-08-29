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
# Whether the authenticated-identity probe (section 5) actually produced a
# verdict. The summary must not claim "all invariants hold" when the single
# most important one was never evaluated.
PROBE_VERDICT=0

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
echo "── 2b. The one open anon table stays tenant-free ─────────────"
# public.capacity is the single anon-readable table whose policy is
# USING (true) — the shape CLAUDE.md rule 1 forbids. It is acceptable ONLY
# because the table holds no tenant data: quarter, booked, cans_capacity,
# bottles_capacity, week_start. The public marketing site reads it.
#
# That is an assumption about the schema, and CLAUDE.md's central lesson is
# that assumptions expire silently. So assert it from outside, with the same
# key an attacker would use: if the table ever gains a column that identifies
# a client, the USING (true) stops being safe and this fails.
cap=$(curl -s --max-time 20 "$SUPA/rest/v1/capacity?select=*&limit=1" -H "apikey: $ANON")
if echo "$cap" | grep -q '42501'; then
  pass "capacity — not anon-readable (policy tightened since; fine)"
else
  leaky=$(echo "$cap" | grep -oiE '"(client_id|client_name|customer_id|company|brand|account_id|owner|email)"' | sort -u | tr '
' ' ')
  if [ -n "$leaky" ]; then
    fail "capacity — tenant-identifying column now anon-readable: $leaky"
  else
    pass "capacity — anon-readable but carries no tenant identifier"
  fi
fi

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


echo "── 5. A self-registered stranger is not staff ────────────────"
# Sections 1-4 only ever authenticate as `anon`. That is one of the three
# identities CLAUDE.md asks for, and not the one that failed on 2026-08-28:
# handle_new_user() was a denylist, so ANY bare signup received an active
# 'sales' profiles row. An active profiles row IS is_gl_staff(), which cleared
# the tenant guard and reached the legacy "authed all" USING(true) policies —
# full CRUD on every table. An anon-only probe cannot see that at all.
#
# THIS SECTION MUST PRODUCE A VERDICT, NOT A SHRUG.
# A first version reported SKIP when email confirmation withheld a session, and
# the run still ended "All security invariants hold" with exit 0 — the critical
# invariant unverified behind a green check. That is the same defect this whole
# audit has been chasing, so: when the probe is requested, any inability to
# verify is a FAILURE.
#
# The profile assertion is made SERVER-SIDE through the Supabase Management API,
# so it does not depend on the new user getting a session, and works whether or
# not email confirmation is enabled. SUPABASE_ACCESS_TOKEN stays in the runner
# environment: it is never sent to a browser, never written to a client file,
# and never echoed here.
if [ "${GL_INVARIANT_SIGNUP_PROBE:-0}" != "1" ]; then
  printf '  \033[33mskip\033[0m %s\n' "signup probe not requested (set GL_INVARIANT_SIGNUP_PROBE=1)"
  echo "         Not counted as a pass. The scheduled run and manual dispatch set it."
else
  PROJECT_REF="ufjkeqmxwuyhbqyugcgg"

  # JSON in and out. Uses jq when present, node otherwise — both ship on
  # GitHub runners, and node keeps this runnable in Git Bash where jq is not
  # installed, so the parsing can be exercised locally.
  if command -v jq >/dev/null 2>&1;      then JSONTOOL=jq
  elif command -v node >/dev/null 2>&1;  then JSONTOOL=node
  else JSONTOOL=""; fi

  # Wrap a SQL string as {"query": "..."} .
  json_wrap(){
    if [ "$JSONTOOL" = "jq" ]; then printf '%s' "$1" | jq -Rs '{query: .}'
    else printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({query:s})))'
    fi
  }
  # Pull one integer field out of a response like [{"n":0}].
  jnum(){
    if [ "$JSONTOOL" = "jq" ]; then printf '%s' "$1" | jq -r ".[0].$2 // empty" 2>/dev/null
    else printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=Array.isArray(j)&&j[0]?j[0][process.argv[1]]:undefined;process.stdout.write(v===undefined||v===null?"":String(v));}catch(e){}})' "$2" 2>/dev/null
    fi
  }
  # Pull one string field, checking a couple of shapes the signup response uses.
  jstr(){
    if [ "$JSONTOOL" = "jq" ]; then printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null
    else printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const p=process.argv[1].split(".").filter(Boolean);let v=j;for(const k of p){v=v&&v[k];}process.stdout.write(v==null?"":String(v));}catch(e){}})' "$2" 2>/dev/null
    fi
  }

  # Run one statement server-side and echo the raw JSON body.
  # The token is passed via a header from the environment and never printed.
  mgmt(){
    curl -sS --max-time 30 -X POST \
      "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$(json_wrap "$1")"
  }

  if [ -z "$JSONTOOL" ]; then
    fail "signup probe requested but neither jq nor node is available — cannot verify server-side"
  elif [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    fail "signup probe requested but SUPABASE_ACCESS_TOKEN is not set — the profile assertion cannot be performed"
  else
    probe_email="invariant-probe-$(date +%s)-$RANDOM@example.invalid"
    probe_pw="Pr0be-$RANDOM-$RANDOM-Aa!"
    signup=$(curl -sS --max-time 25 -X POST "$SUPA/auth/v1/signup" \
      -H "apikey: $ANON" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$probe_email\",\"password\":\"$probe_pw\"}")

    uid=$(jstr "$signup" '.user.id')
    [ -z "$uid" ] && uid=$(jstr "$signup" '.id')
    tok=$(jstr "$signup" '.access_token')

    if printf '%s' "$signup" | grep -qi 'signup_disabled\|signups not allowed'; then
      # Nobody can self-register at all. Strongest possible result.
      PROBE_VERDICT=1
      pass "self-service signup is disabled — a stranger cannot create an account"
    elif [ -z "$uid" ]; then
      fail "signup probe could not obtain a user id — cannot verify the invariant. Response: $(printf '%s' "$signup" | head -c 200)"
    else
      # ── THE invariant, asserted server-side ──────────────────────
      PROBE_VERDICT=1
      prof=$(mgmt "select count(*)::int as n from public.profiles where id = '$uid';")
      n=$(jnum "$prof" n)
      if [ -z "$n" ]; then
        fail "could not read profiles server-side — the invariant is UNVERIFIED. Response: $(printf '%s' "$prof" | head -c 200)"
      elif [ "$n" -ne 0 ]; then
        fail "SELF-SIGNUP RECEIVED A STAFF PROFILE ($n row) — handle_new_user() is not gating on invited_at"
      else
        pass "self-signup received NO staff profile (verified server-side)"
      fi

      # Sanity: the account really was created, so a zero above means the
      # trigger declined rather than the signup silently failing.
      au=$(mgmt "select count(*)::int as n from auth.users where id = '$uid';")
      an=$(jnum "$au" n)
      if [ "$an" = "1" ]; then
        pass "the probe account was really created (so the zero above is the trigger declining)"
      else
        fail "probe account not found server-side — the profile check above proved nothing"
      fi

      # ── Data access, when a session is available ─────────────────
      if [ -n "$tok" ]; then
        auth=(-H "apikey: $ANON" -H "Authorization: Bearer $tok")
        for t in clients invoices formulas lot_documents customer_users; do
          body=$(curl -sS --max-time 20 "$SUPA/rest/v1/$t?select=*&limit=1" "${auth[@]}")
          if echo "$body" | grep -q '42501'; then
            pass "$t — permission denied to a self-registered account"
          elif [ "$body" = "[]" ]; then
            pass "$t — no rows visible to a self-registered account"
          else
            fail "$t — VISIBLE TO A SELF-REGISTERED ACCOUNT: $(echo "$body" | head -c 160)"
          fi
        done
      else
        # No session because email confirmation is on. Not a gap any more: the
        # decisive assertion above already ran server-side. Say what was and was
        # not covered rather than implying full coverage.
        echo "         note: email confirmation is on, so no session was issued."
        echo "         The profile assertion above is server-side and unaffected."
        echo "         Per-row read denial for a CONFIRMED account is not covered here."
      fi

      # ── Cleanup, verified ────────────────────────────────────────
      mgmt "delete from auth.users where id = '$uid';" >/dev/null
      left=$(jnum "$(mgmt "select count(*)::int as n from auth.users where id = '$uid';")" n)
      if [ "$left" = "0" ]; then
        pass "probe account deleted"
      else
        fail "probe account was NOT deleted (id $uid) — remove it by hand"
      fi
    fi
  fi
fi

echo
if [ "$FAILED" -ne 0 ]; then
  echo "SECURITY INVARIANT VIOLATED — see failures above."
  echo "If a lockdown broke a public flow, each supabase/migrations/2026080*.sql"
  echo "file carries a rollback note at the top."
elif [ "$PROBE_VERDICT" -eq 1 ]; then
  echo "All security invariants hold, including the authenticated-identity probe."
else
  # Never claim full coverage when section 5 produced no verdict. The
  # authenticated-identity invariant is the one that actually failed in
  # production, so a run without it is partial by definition.
  echo "Sections 1-4 hold. The authenticated-identity probe did NOT run,"
  echo "so the invariant that failed on 2026-08-28 is UNVERIFIED by this run."
  echo "It runs on the daily schedule and on manual dispatch."
fi
exit "$FAILED"
