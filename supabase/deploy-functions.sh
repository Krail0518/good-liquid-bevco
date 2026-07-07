#!/usr/bin/env bash
# ============================================================
# deploy-functions.sh — one-shot deploy of all 7 edge functions
# ============================================================
# Runs from the repo root via either Git Bash (Windows) or any
# POSIX shell (macOS / Linux). Idempotent — safe to re-run after
# changing a secret or a function body.
#
# Usage:
#   1. cp supabase/secrets.example.env supabase/secrets.env
#   2. Fill in supabase/secrets.env with your real keys
#   3. bash supabase/deploy-functions.sh
#
# Or set the SECRETS_ENV variable to point at any .env file:
#   SECRETS_ENV=path/to/my.env bash supabase/deploy-functions.sh
# ============================================================

set -euo pipefail

# ----- Locate repo root and secrets file -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_FILE="${SECRETS_ENV:-$REPO_ROOT/supabase/secrets.env}"

# ----- Sanity checks -----
echo ""
echo "🔧 Good Liquid CRM — Edge function deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v supabase >/dev/null 2>&1; then
  echo "❌ Supabase CLI not found in PATH."
  echo "   Install: https://supabase.com/docs/guides/cli"
  echo "   macOS:   brew install supabase/tap/supabase"
  echo "   Windows: winget install Supabase.CLI"
  exit 1
fi
echo "✓ supabase CLI:   $(supabase --version 2>/dev/null || echo unknown)"

if ! supabase projects list >/dev/null 2>&1; then
  echo "❌ Not logged in. Run:  supabase login"
  exit 1
fi
echo "✓ Logged in"

# Make sure repo is linked to a project
cd "$REPO_ROOT"
if [ ! -f .supabase/config.toml ] && [ ! -f supabase/.temp/project-ref ]; then
  echo "⚠  Repo doesn't look linked to a project."
  echo "   Run:  supabase link --project-ref <your-project-ref>"
  echo "   (Find your ref in Supabase dashboard → Settings → General)"
  exit 1
fi
echo "✓ Project linked"

# ----- Load secrets -----
if [ ! -f "$SECRETS_FILE" ]; then
  echo ""
  echo "⚠  No secrets file at: $SECRETS_FILE"
  echo "   Copy the template:"
  echo "     cp supabase/secrets.example.env supabase/secrets.env"
  echo "   Then fill in your real values and re-run this script."
  echo ""
  echo "   You can deploy WITHOUT setting secrets — functions will deploy"
  echo "   but will error at runtime until secrets are set."
  read -rp "Continue anyway? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 1
  SKIP_SECRETS=1
else
  echo "✓ Secrets file:   $SECRETS_FILE"
  SKIP_SECRETS=0
fi

# ----- Set secrets (skip empty lines and ones with empty values) -----
if [ "$SKIP_SECRETS" = "0" ]; then
  echo ""
  echo "📦 Setting secrets..."
  # Build list of KEY=VALUE pairs, skipping comments / blanks / unset values
  SECRET_ARGS=()
  while IFS= read -r line || [ -n "$line" ]; do
    # Strip trailing CR (Windows line endings)
    line="${line%$'\r'}"
    # Skip comments and blanks
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Split into KEY=VALUE
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      # Strip surrounding quotes
      val="${val%\"}"; val="${val#\"}"
      val="${val%\'}"; val="${val#\'}"
      # Skip if obviously a placeholder
      if [[ -z "$val" || "$val" == "your-"* || "$val" == "REPLACE_"* || "$val" == "xxx"* ]]; then
        echo "  ⊘ skip $key (placeholder or empty)"
        continue
      fi
      SECRET_ARGS+=("$key=$val")
      echo "  ✓ stage $key"
    fi
  done < "$SECRETS_FILE"

  if [ "${#SECRET_ARGS[@]}" -gt 0 ]; then
    supabase secrets set "${SECRET_ARGS[@]}"
    echo "  → ${#SECRET_ARGS[@]} secret(s) set"
  else
    echo "  ⚠  No secrets to set — all values were empty or placeholders"
  fi
fi

# ----- Deploy each function -----
FUNCS=(
  invite-staff-user
  delete-staff-user
  stripe-checkout-session
  send-sms
  dropbox-sign
  qbo-connect
  qbo-callback
  qbo-disconnect
  qbo-push-invoice
  mailgun-send
  mailgun-webhook
  mailgun-inbound
  booking-confirm
  email-scheduler
  ai-proxy
  daily-digest
)

echo ""
echo "🚀 Deploying functions..."
PROJECT_REF="$(supabase projects list --output json 2>/dev/null | grep -oE '"linked":true[^}]*"id":"[^"]+"' | head -1 | grep -oE '"id":"[^"]+"' | sed 's/"id":"//;s/"//')"
FUNC_URL_BASE="https://${PROJECT_REF}.supabase.co/functions/v1"

DEPLOYED=()
FAILED=()
for fn in "${FUNCS[@]}"; do
  if [ ! -d "supabase/functions/$fn" ]; then
    echo "  ⊘ $fn — directory missing, skipping"
    continue
  fi
  echo ""
  echo "  ─── $fn ───"
  # qbo-callback and the customer-portal NPS endpoint need to accept anonymous
  # callers (they're hit by Intuit's OAuth redirect and the public NPS form).
  # qbo-connect / qbo-push-invoice / qbo-disconnect need the user's JWT.
  NO_VERIFY_JWT=""
  case "$fn" in
    qbo-callback|mailgun-webhook|mailgun-inbound) NO_VERIFY_JWT="--no-verify-jwt" ;;
  esac
  if supabase functions deploy "$fn" $NO_VERIFY_JWT; then
    DEPLOYED+=("$fn")
  else
    FAILED+=("$fn")
  fi
done

# ----- Summary -----
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deploy complete"
echo ""
if [ "${#DEPLOYED[@]}" -gt 0 ]; then
  echo "Deployed (${#DEPLOYED[@]}):"
  for fn in "${DEPLOYED[@]}"; do
    if [ -n "$PROJECT_REF" ]; then
      echo "  ✓ $fn → ${FUNC_URL_BASE}/${fn}"
    else
      echo "  ✓ $fn"
    fi
  done
fi
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  echo "Failed (${#FAILED[@]}):"
  for fn in "${FAILED[@]}"; do echo "  ✗ $fn"; done
  exit 1
fi
echo ""
echo "Next steps:"
echo "  • Test send-sms:        curl -X POST '<url>/send-sms' -H 'Authorization: Bearer <anon-key>' -d '{\"to\":\"+18135550100\",\"body\":\"hi\"}'"
echo "  • Test stripe-checkout: trigger via 'Pay Now' in customer portal"
echo "  • Connect QuickBooks:   in CRM, AI toolbar → ⚙ Settings → QuickBooks → Connect"
echo ""
