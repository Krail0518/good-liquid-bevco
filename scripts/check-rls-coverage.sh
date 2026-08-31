#!/usr/bin/env bash
# check-rls-coverage.sh — fail when an unconditional permissive RLS policy has
# no RESTRICTIVE companion and has not been reviewed.
#
# WHY THIS EXISTS
# ---------------
# The external auditor accepted the constrain-don't-rewrite pattern but rejected
# the evidence for it: "Restrictive policies can safely constrain permissive
# ones, but only when role, command, table, and operation coverage align. Policy
# counts do not prove complete effective coverage."
#
# That is right. Reporting "318 restrictive policies are in force" says nothing
# about whether the right ones line up with the 228 unconditional permissive
# ones. This asks per (table, command, role) and fails on anything uncovered
# that is not in a reviewed allowlist with a reason.
#
# It reads PRODUCTION, not the repository, for the reason the drift gate does:
# the worst finding in this system's history was applied by hand in a dashboard
# and appeared in no file.
#
# USAGE
#   bash scripts/check-rls-coverage.sh            # compare, fail on anything new
#   bash scripts/check-rls-coverage.sh --list     # print what production has
#
# Requires SUPABASE_ACCESS_TOKEN. Read from the environment, sent only as a
# request header, never echoed. CI supplies it.

set -uo pipefail

PROJECT_REF="ufjkeqmxwuyhbqyugcgg"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUERY_FILE="$ROOT/scripts/rls-coverage.sql"
ALLOWLIST="$ROOT/docs/database/rls-coverage-allowlist.txt"
MODE="${1:-check}"

if [ ! -f "$QUERY_FILE" ]; then
  echo "missing $QUERY_FILE" >&2; exit 2
fi
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN is not set — cannot read production state." >&2
  echo "This is a FAILURE, not a skip: an unverifiable coverage check is worth nothing." >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1;     then JT=jq
elif command -v node >/dev/null 2>&1; then JT=node
else echo "need jq or node to build/parse JSON" >&2; exit 1; fi

wrap_query() {
  if [ "$JT" = "jq" ]; then jq -Rs '{query: .}' < "$1"
  else node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({query:fs.readFileSync(process.argv[1],"utf8")}))' "$1"
  fi
}

resp=$(curl -sS --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(wrap_query "$QUERY_FILE")")

if [ "$JT" = "jq" ]; then
  current=$(printf '%s' "$resp" | jq -r '.[].line' 2>/dev/null)
else
  current=$(printf '%s' "$resp" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{ const j=JSON.parse(s);
        if(!Array.isArray(j)){ process.exit(3); }
        process.stdout.write(j.map(r=>r.line).join("\n"));
      }catch(e){ process.exit(3); }
    });')
fi

# An empty result is legitimate here — it means every permissive policy is
# covered — so distinguish "no rows" from "the request failed".
if ! printf '%s' "$resp" | grep -q '^\['; then
  echo "Could not read RLS coverage from production." >&2
  echo "Response head: $(printf '%s' "$resp" | head -c 300)" >&2
  exit 1
fi

if [ "$MODE" = "--list" ]; then
  printf '%s\n' "$current"
  exit 0
fi

if [ ! -f "$ALLOWLIST" ]; then
  echo "No allowlist at $ALLOWLIST" >&2; exit 1
fi

# Strip comments and inline reasons; compare the table|CMD|role keys only.
allowed=$(grep -v '^[[:space:]]*#' "$ALLOWLIST" | sed 's/[[:space:]]*#.*$//' | sed 's/[[:space:]]*$//' | grep -v '^$' | sort)
have=$(printf '%s\n' "$current" | grep -v '^$' | sort)

unreviewed=$(comm -13 <(printf '%s\n' "$allowed") <(printf '%s\n' "$have"))
stale=$(comm -23 <(printf '%s\n' "$allowed") <(printf '%s\n' "$have"))

status=0

if [ -n "$unreviewed" ]; then
  echo
  echo "UNREVIEWED PERMISSIVE POLICY COVERAGE"
  echo "These (table, command, role) combinations have an unconditional"
  echo "permissive policy and NO restrictive policy constraining them, and are"
  echo "not in docs/database/rls-coverage-allowlist.txt:"
  echo
  printf '%s\n' "$unreviewed" | sed 's/^/  + /'
  echo
  echo "Either scope the policy, add a RESTRICTIVE guard, or — if the table"
  echo "genuinely carries no client data — add the line to the allowlist WITH a"
  echo "reason and a live probe result."
  status=1
fi

if [ -n "$stale" ]; then
  echo
  echo "STALE ALLOWLIST ENTRIES"
  echo "These are allowed but no longer present in production. An exemption"
  echo "nobody is reading is worse than none — remove them:"
  echo
  printf '%s\n' "$stale" | sed 's/^/  - /'
  status=1
fi

if [ "$status" = "0" ]; then
  echo "RLS coverage OK: $(printf '%s\n' "$have" | grep -c . ) uncovered combination(s), all reviewed."
fi

exit "$status"
