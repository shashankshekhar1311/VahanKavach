#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Configure zero-cost sandbox secrets on the VahanKavach STAGING Supabase project.
#
# Usage:
#   export STAGING_TELEGRAM_BOT_TOKEN="123456:ABC..."   # from @BotFather for VahanKavachDevBot
#   # optional overrides:
#   # export VEHICLE_PROVIDER=SETU_SANDBOX
#   # export SETU_CLIENT_ID=... SETU_CLIENT_SECRET=...
#   # export RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=...
#   ./scripts/setup-sandbox-secrets.sh
#   ./scripts/setup-sandbox-secrets.sh rygvtxqbhgteqgvmczxu
#
# Requires: Supabase CLI logged in (`supabase login`) and project access to REF.
# -----------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Positional project-ref wins over env / default
REF="${1:-${SUPABASE_PROJECT_REF:-rygvtxqbhgteqgvmczxu}}"
VEHICLE_PROVIDER="${VEHICLE_PROVIDER:-MOCK}"
TELEGRAM_BOT_TOKEN="${STAGING_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
TELEGRAM_BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-VahanKavachDevBot}"
SETU_BASE_URL="${SETU_BASE_URL:-https://sandbox.setu.co/api/v1}"
SETU_CLIENT_ID="${SETU_CLIENT_ID:-mock_setu_client_id}"
SETU_CLIENT_SECRET="${SETU_CLIENT_SECRET:-mock_setu_client_secret}"
RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-rzp_test_xxxx}"
RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET:-test_secret_xxxx}"
APP_BASE_URL="${APP_BASE_URL:-http://localhost:3000}"

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YLW=$'\033[0;33m'
NC=$'\033[0m'

die() { printf '%s✗%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }
ok() { printf '%s✓%s %s\n' "$GRN" "$NC" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$NC" "$*"; }

# Prefer installed CLI; fall back to npx (common on Windows/CI).
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_BIN=(supabase)
elif command -v npx >/dev/null 2>&1; then
  SUPABASE_BIN=(npx --yes supabase)
else
  die "Supabase CLI not found. Install: https://supabase.com/docs/guides/cli (or ensure npx is available)"
fi

if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
  die "Set STAGING_TELEGRAM_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) to the @VahanKavachDevBot token from BotFather."
fi

case "$VEHICLE_PROVIDER" in
  MOCK|SETU_SANDBOX) ;;
  *)
    warn "VEHICLE_PROVIDER=$VEHICLE_PROVIDER — expected MOCK or SETU_SANDBOX for sandbox"
    ;;
esac

printf '=== VahanKavach sandbox secrets ===\n'
printf 'project-ref: %s\n' "$REF"
printf 'VEHICLE_PROVIDER: %s\n' "$VEHICLE_PROVIDER"
printf 'TELEGRAM_BOT_USERNAME: %s\n' "$TELEGRAM_BOT_USERNAME"
printf 'SETU_BASE_URL: %s\n' "$SETU_BASE_URL"
printf 'APP_BASE_URL: %s\n' "$APP_BASE_URL"
printf '\n'

"${SUPABASE_BIN[@]}" secrets set \
  --project-ref "$REF" \
  "ENVIRONMENT=staging" \
  "VEHICLE_PROVIDER=${VEHICLE_PROVIDER}" \
  "VEHICLE_PROVIDER_MODE=${VEHICLE_PROVIDER}" \
  "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" \
  "TELEGRAM_BOT_USERNAME=${TELEGRAM_BOT_USERNAME}" \
  "SETU_BASE_URL=${SETU_BASE_URL}" \
  "SETU_CLIENT_ID=${SETU_CLIENT_ID}" \
  "SETU_CLIENT_SECRET=${SETU_CLIENT_SECRET}" \
  "SETU_AUTH_MODE=headers" \
  "RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}" \
  "RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET}" \
  "APP_BASE_URL=${APP_BASE_URL}" \
  "USE_MOCK_PROVIDER=$([[ "$VEHICLE_PROVIDER" == "MOCK" ]] && echo true || echo false)"

ok "Secrets applied to project ${REF}"
warn "Redeploy Edge Functions so they pick up new secrets:"
printf '  npx supabase functions deploy --project-ref %s\n' "$REF"
printf '\nSwitch to Setu sandbox later with:\n'
printf '  VEHICLE_PROVIDER=SETU_SANDBOX SETU_CLIENT_ID=... SETU_CLIENT_SECRET=... ./scripts/setup-sandbox-secrets.sh\n'
