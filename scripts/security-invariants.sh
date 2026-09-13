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
# EVERY PROBE HAS THREE OUTCOMES, NEVER TWO.
# The first version had two: a response it recognised as a refusal, and
# "ANONYMOUS DATA VISIBLE" for everything else. On 2026-09-13 the daily run
# met a 504 from the API gateway and reported `deals` and `profiles` as
# world-readable. Nothing was exposed — the request never reached Postgres —
# and the run was simply re-run until it went green.
#
# That is the worst thing a security alarm can do. It trains its readers to
# treat a red run as noise and re-run it, which is precisely the reflex that
# let the real hole survive, and the same "a check that cries wolf gets
# ignored" that section 4 below was already careful about. So:
#
#   ok          the invariant was tested and holds
#   FAIL        the invariant was tested and is VIOLATED — data is exposed
#   UNVERIFIED  the probe could not reach the system, so it proved nothing
#
# UNVERIFIED still fails the run — an unchecked invariant must never ride a
# green check, which is the lesson section 5 carries — but it never claims
# exposure it did not observe. The summary at the bottom says which happened,
# so the person reading the failure e-mail can tell "someone can read your
# invoices" from "the gateway timed out".
#
# Usage:  bash scripts/security-invariants.sh
# Exit 0 = every invariant was tested and holds.
# Exit 1 = an invariant is violated, OR one could not be tested.

set -uo pipefail

# Production by default. The overrides exist so tests/security-invariants-
# classifier.test.cjs can point the probes at a local stub and prove the
# classifier calls a timeout a timeout. CI sets neither, so CI probes
# production; an overridden run announces itself loudly below so its output
# can never be mistaken for one.
SUPA="${GL_INVARIANT_SUPA_URL:-https://ufjkeqmxwuyhbqyugcgg.supabase.co}"
SITE="${GL_INVARIANT_SITE_URL:-https://www.goodliquidbevco.com}"
ANON="${GL_INVARIANT_ANON_KEY:-sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB}"
FAILED=0
# A probe that could not reach the system. Separate from FAILED because the
# two mean opposite things to whoever reads the run, even though both are
# red. Both contribute to the exit code.
UNVERIFIED=0
# Whether the authenticated-identity probe (section 5) actually produced a
# verdict. The summary must not claim "all invariants hold" when the single
# most important one was never evaluated.
PROBE_VERDICT=0

# Retry budget for the transport failures — a 5xx from the gateway, a reset
# connection, a DNS blip. These are not verdicts, so they are retried before
# the probe gives up and reports UNVERIFIED.
PROBE_ATTEMPTS="${GL_INVARIANT_PROBE_ATTEMPTS:-3}"
PROBE_BACKOFF="${GL_INVARIANT_PROBE_BACKOFF:-2}"

pass(){ printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
# Deliberately not called "skip": nothing here is optional. This is a probe
# that came back with no information, and the run stays red because of it.
unver(){ printf '  \033[33m????\033[0m UNVERIFIED — %s\n' "$1"; UNVERIFIED=1; }

HTTP_CODE=000
HTTP_BODY=""

# Run one probe, retrying only the failures that are transport rather than
# policy. Sets HTTP_CODE and HTTP_BODY. Returns 0 when a response arrived
# that is worth classifying, 1 when every attempt failed to reach the API.
#
# A 401/403 is a RESPONSE, not a failure — it is usually the very refusal we
# are hoping for — so it is never retried. Only 000 (no response at all),
# 5xx, 408 and 429 are.
http_probe(){
  local attempt=1 rc out
  while :; do
    out=$(curl -s --max-time 20 -w '\n%{http_code}' "$@"); rc=$?
    HTTP_CODE=$(printf '%s\n' "$out" | tail -n 1)
    HTTP_BODY=$(printf '%s\n' "$out" | sed '$d')
    case "$HTTP_CODE" in ''|*[!0-9]*) HTTP_CODE=000 ;; esac
    if [ "$rc" -eq 0 ] && [ "$HTTP_CODE" != "000" ] && [ "$HTTP_CODE" -lt 500 ] \
       && [ "$HTTP_CODE" -ne 408 ] && [ "$HTTP_CODE" -ne 429 ]; then
      return 0
    fi
    [ "$attempt" -ge "$PROBE_ATTEMPTS" ] && return 1
    [ "$PROBE_BACKOFF" -gt 0 ] && sleep $((attempt * PROBE_BACKOFF))
    attempt=$((attempt + 1))
  done
}

why(){ [ "$HTTP_CODE" = "000" ] && printf 'no response from the API' || printf 'HTTP %s' "$HTTP_CODE"; }
snip(){ if [ -z "$HTTP_BODY" ]; then printf '(empty body)'; else printf '%s' "$HTTP_BODY" | head -c 120; fi; }

if [ -n "${GL_INVARIANT_SUPA_URL:-}${GL_INVARIANT_SITE_URL:-}${GL_INVARIANT_ANON_KEY:-}" ]; then
  printf '\n\033[33m!! TARGET OVERRIDDEN — this run probes %s / %s, NOT production.\033[0m\n' "$SUPA" "$SITE"
  printf '\033[33m!! Its result says nothing about the live system.\033[0m\n'
fi

echo
echo "── 1. No anonymous access to business data ───────────────────"
# Every one of these was world-readable AND world-writable before the audit.
for t in clients invoices deals quotes profiles customer_users onboarding \
         expenses audit_log invoice_payments client_notes client_rate_overrides \
         formulas vendors production_runs sample_shipments referrals referrers \
         trade_shows content_calendar yield_logs defects company_docs qbo_tokens; do
  if ! http_probe "$SUPA/rest/v1/$t?select=*&limit=1" -H "apikey: $ANON"; then
    unver "$t — the probe never reached the database ($(why)). This is NOT evidence of exposure."
    continue
  fi
  # Acceptable: permission denied (42501), or an empty set (RLS filtered all rows).
  if echo "$HTTP_BODY" | grep -q '42501'; then
    pass "$t — permission denied"
  elif [ "$HTTP_BODY" = "[]" ]; then
    pass "$t — no rows visible"
  elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    # The API answered, successfully, with something other than an empty set.
    # That is rows, and rows here are the incident this script exists for.
    fail "$t — ANONYMOUS DATA VISIBLE: $(snip)"
  else
    # Answered, but with neither a refusal nor data: a 404 from a renamed
    # table, a malformed request, an auth error of some other shape. It does
    # not prove exposure and it does not prove safety.
    unver "$t — unexpected $(why), so exposure is untested: $(snip)"
  fi
done

echo
echo "── 2. No anonymous writes ────────────────────────────────────"
for t in clients invoices deals; do
  if ! http_probe -X DELETE "$SUPA/rest/v1/$t?id=neq.00000000-0000-0000-0000-000000000000" -H "apikey: $ANON"; then
    unver "$t — the delete probe never reached the database ($(why)). NOT evidence the delete was allowed."
    continue
  fi
  if echo "$HTTP_BODY" | grep -q '42501'; then
    pass "$t — delete refused"
  elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    # A 204 with an empty body is what a SUCCESSFUL anonymous delete looks
    # like. This branch is the alarm.
    fail "$t — ANONYMOUS DELETE NOT REFUSED: HTTP $HTTP_CODE $(snip)"
  else
    unver "$t — the delete came back as an unexpected $(why), so no refusal by RLS was observed: $(snip)"
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
#
# This one needed the three-outcome rule most, and in the dangerous direction:
# a timeout body carries no column names either, so the old two-way test read
# a 504 as "no tenant identifier" and PASSED.
if ! http_probe "$SUPA/rest/v1/capacity?select=*&limit=1" -H "apikey: $ANON"; then
  unver "capacity — the probe never reached the database ($(why)), so its columns were not inspected."
elif echo "$HTTP_BODY" | grep -q '42501'; then
  pass "capacity — not anon-readable (policy tightened since; fine)"
elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  leaky=$(echo "$HTTP_BODY" | grep -oiE '"(client_id|client_name|customer_id|company|brand|account_id|owner|email)"' | sort -u | tr '\n' ' ')
  if [ -n "$leaky" ]; then
    fail "capacity — tenant-identifying column now anon-readable: $leaky"
  else
    pass "capacity — anon-readable but carries no tenant identifier"
  fi
else
  unver "capacity — unexpected $(why), so its columns were not inspected: $(snip)"
fi

echo
echo "── 3. The public surface still works ─────────────────────────"
# These SHOULD be reachable anonymously — the portal and public pages depend
# on them. A failure here means a lockdown went too far and broke customers.
# An unreachable host is a different claim from a broken endpoint, and gets
# the different label.
probe_public(){   # $1 = label; rest = curl args
  local label="$1"; shift
  if ! http_probe "$@"; then
    unver "$label — could not be reached ($(why)), so it was not tested."
  elif [ "$HTTP_CODE" = "200" ]; then
    pass "$label"
  else
    fail "$label — broken, HTTP $HTTP_CODE"
  fi
}

probe_public "public invoice links (get_shared_invoice)" -X POST "$SUPA/rest/v1/rpc/get_shared_invoice" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p_token":"probe"}'

probe_public "client onboarding page (gl_onboarding_get)" -X POST "$SUPA/rest/v1/rpc/gl_onboarding_get" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p_token":"probe"}'

# Probed with an EMPTY payload so it validates and rejects without creating a
# deal — reachability without side effects.
if ! http_probe -X POST "$SUPA/rest/v1/rpc/submit_quote_request" \
     -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p":{}}'; then
  unver "public quote form (submit_quote_request) — could not be reached ($(why)), so it was not tested."
elif echo "$HTTP_BODY" | grep -q 'brand_name is required'; then
  pass "public quote form (submit_quote_request)"
else
  fail "quote form unreachable or changed: $(snip)"
fi

for p in "/" "/?portal=1" "/onboard.html"; do
  probe_public "page $p" -L --max-time 25 -o /dev/null "$SITE$p"
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
# verify fails the run. It reports UNVERIFIED rather than FAIL, because "we
# could not ask" and "the answer was wrong" are different facts; both are red.
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
  # Every statement here is a select or an idempotent delete, so retrying a
  # gateway failure is safe — and an unreachable Management API says nothing
  # about the invariant, exactly as in section 1.
  mgmt(){
    if ! http_probe --max-time 30 -X POST \
      "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$(json_wrap "$1")"; then
      # Says why rather than returning an empty string: this runs in a command
      # substitution, so HTTP_CODE never reaches the caller, and "no response"
      # is the one thing the caller most needs to print.
      printf '{"unreachable":"the Management API could not be reached (%s)"}' "$(why)"
      return 1
    fi
    printf '%s' "$HTTP_BODY"
  }

  if [ -z "$JSONTOOL" ]; then
    unver "the signup probe was requested but neither jq nor node is available — it cannot be verified server-side"
  elif [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    unver "the signup probe was requested but SUPABASE_ACCESS_TOKEN is not set — the profile assertion cannot be performed"
  else
    probe_email="invariant-probe-$(date +%s)-$RANDOM@example.invalid"
    probe_pw="Pr0be-$RANDOM-$RANDOM-Aa!"
    # NOT retried: a signup is not idempotent, and a second attempt after a
    # timeout could leave an account nobody cleans up.
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
      unver "the signup probe could not obtain a user id, so the invariant was not tested. Response: $(printf '%s' "$signup" | head -c 200)"
    else
      # ── THE invariant, asserted server-side ──────────────────────
      PROBE_VERDICT=1
      prof=$(mgmt "select count(*)::int as n from public.profiles where id = '$uid';")
      n=$(jnum "$prof" n)
      if [ -z "$n" ]; then
        unver "public.profiles could not be read server-side, so the invariant was not tested. Response: $(printf '%s' "$prof" | head -c 200)"
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
        unver "the probe account was not found server-side, so the profile check above proved nothing"
      fi

      # ── Data access, when a session is available ─────────────────
      if [ -n "$tok" ]; then
        for t in clients invoices formulas lot_documents customer_users; do
          if ! http_probe "$SUPA/rest/v1/$t?select=*&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $tok"; then
            unver "$t — the probe never reached the database ($(why)). NOT evidence of exposure to a self-registered account."
          elif echo "$HTTP_BODY" | grep -q '42501'; then
            pass "$t — permission denied to a self-registered account"
          elif [ "$HTTP_BODY" = "[]" ]; then
            pass "$t — no rows visible to a self-registered account"
          elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
            fail "$t — VISIBLE TO A SELF-REGISTERED ACCOUNT: $(snip)"
          else
            unver "$t — unexpected $(why), so exposure to a self-registered account is untested: $(snip)"
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
        # A real leftover, not a missed measurement: the account exists, or we
        # cannot tell that it does not. Either way somebody must go and look.
        fail "probe account was NOT deleted (id $uid) — remove it by hand"
      fi
    fi
  fi
fi

echo
if [ "$FAILED" -ne 0 ]; then
  echo "SECURITY INVARIANT VIOLATED — see the FAIL lines above."
  echo "This is a finding about the live system, not about this run. Do not re-run it."
  echo "If a lockdown broke a public flow, each supabase/migrations/2026080*.sql"
  echo "file carries a rollback note at the top."
  [ "$UNVERIFIED" -ne 0 ] && echo "Some probes were also UNVERIFIED — their invariants were never tested."
elif [ "$UNVERIFIED" -ne 0 ]; then
  echo "NOT PROVEN — one or more probes could not reach the system, so the"
  echo "invariants they cover were never tested. NO EXPOSURE WAS OBSERVED:"
  echo "every probe that got an answer got the right one."
  echo "Each UNVERIFIED line above says what came back instead. A gateway"
  echo "timeout or a 5xx has already been retried ${PROBE_ATTEMPTS}x here; if it persists,"
  echo "check the Supabase status page before reading anything else into it."
  echo "The run stays red on purpose: an untested invariant must not ride a green check."
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
# Both reds exit 1. A violated invariant and an untested one are different
# facts, reported differently above, but neither may leave CI green.
if [ "$FAILED" -ne 0 ] || [ "$UNVERIFIED" -ne 0 ]; then exit 1; fi
exit 0
