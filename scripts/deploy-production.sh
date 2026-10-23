#!/usr/bin/env bash
# Module 5 â€” production deploy + smoke test for VahanKavach (Supabase).
#
# Usage:
#   export SUPABASE_PROJECT_REF=ssvkwqunozxrruyizvol
#   export VEHICLE_PROVIDER_MODE=SUREPASS_PROD   # or MOCK / SETU_PROD
#   ./scripts/deploy-production.sh
#
# Optional:
#   SUPABASE_ACCESS_TOKEN  â€” if not already logged in via `supabase login`
#   SKIP_SMOKE=1           â€” skip health curl
#   DRY_RUN=1              â€” validate env only

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YLW=$'\033[0;33m'
NC=$'\033[0m'

log() { printf '%s\n' "$*"; }
ok() { printf '%sâœ“%s %s\n' "$GRN" "$NC" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$NC" "$*"; }
die() { printf '%sâœ—%s %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

need() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    die "Missing required env: $name"
  fi
}

log "=== VahanKavach production deploy ==="
log "cwd: $ROOT"

# --- 1) Validate environment ---
need SUPABASE_PROJECT_REF

MODE="${VEHICLE_PROVIDER_MODE:-MOCK}"
case "$MODE" in
  MOCK|SUREPASS_PROD|SETU_PROD) ok "VEHICLE_PROVIDER_MODE=$MODE" ;;
  *) die "VEHICLE_PROVIDER_MODE must be MOCK | SUREPASS_PROD | SETU_PROD (got: $MODE)" ;;
esac

if [[ "$MODE" == "SUREPASS_PROD" ]]; then
  need SUREPASS_API_TOKEN
  ok "Surepass token present"
fi
if [[ "$MODE" == "SETU_PROD" ]]; then
  need SETU_CLIENT_ID
  need SETU_CLIENT_SECRET
  ok "Setu credentials present"
fi

if ! command -v npx >/dev/null 2>&1; then
  die "npx not found â€” install Node.js"
fi
if ! command -v curl >/dev/null 2>&1; then
  die "curl not found"
fi

ok "Tooling ready (npx, curl)"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  ok "DRY_RUN=1 â€” validation only, exiting"
  exit 0
fi

PROJECT_REF="$SUPABASE_PROJECT_REF"
FUNCTIONS_BASE="https://${PROJECT_REF}.supabase.co/functions/v1"

# --- 2) Sync provider mode secret (non-interactive) ---
log "--- Setting VEHICLE_PROVIDER_MODE on project ---"
npx supabase secrets set \
  "VEHICLE_PROVIDER_MODE=${MODE}" \
  --project-ref "$PROJECT_REF" \
  >/dev/null
ok "Secret VEHICLE_PROVIDER_MODE=${MODE}"

# --- 3) Migrations ---
log "--- Pushing database migrations ---"
npx supabase db push --linked --yes
ok "Migrations applied"

# --- 4) Deploy all Edge Functions ---
log "--- Deploying Edge Functions ---"
FUNCTIONS=(
  sync-vehicle
  send-puc-alert
  whatsapp-webhook
  telegram-webhook
  create-billing-checkout
  razorpay-webhook
  create-order
  verify-order
  record-challan-payment
  delete-account
  health
)

for fn in "${FUNCTIONS[@]}"; do
  if [[ -f "supabase/functions/${fn}/index.ts" ]]; then
    log "  deploy ${fn}"
    npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
    ok "deployed ${fn}"
  else
    warn "skip missing function: ${fn}"
  fi
done

# --- 5) Smoke test health ---
if [[ "${SKIP_SMOKE:-0}" == "1" ]]; then
  warn "SKIP_SMOKE=1 â€” skipping health curl"
else
  log "--- Smoke test: GET ${FUNCTIONS_BASE}/health ---"
  HTTP_CODE="$(curl -sS -o /tmp/vk-health.json -w '%{http_code}' \
    "${FUNCTIONS_BASE}/health" || true)"
  BODY="$(cat /tmp/vk-health.json 2>/dev/null || echo '{}')"
  log "HTTP ${HTTP_CODE}"
  log "$BODY"

  if [[ "$HTTP_CODE" != "200" ]]; then
    die "Health smoke test failed (HTTP ${HTTP_CODE})"
  fi

  if ! printf '%s' "$BODY" | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
    # Allow degraded in MOCK-off environments where upstream probe fails temporarily
    if printf '%s' "$BODY" | grep -q '"status"[[:space:]]*:[[:space:]]*"degraded"'; then
      warn "Health reported degraded â€” deploy succeeded; investigate provider probe"
    else
      die "Health response missing healthy/degraded status"
    fi
  else
    ok "Health smoke test passed"
  fi
fi

ok "Production deploy complete for project ${PROJECT_REF}"
log "Dashboard: https://supabase.com/dashboard/project/${PROJECT_REF}/functions"
