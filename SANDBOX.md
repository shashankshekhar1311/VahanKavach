# VahanKavach Staging / Sandbox

Zero-cost end-to-end sandbox against Supabase project **`rygvtxqbhgteqgvmczxu`**.

Dashboard: https://supabase.com/dashboard/project/rygvtxqbhgteqgvmczxu

## What you can test

| Flow | How |
|------|-----|
| Vehicle sync (MOCK) | Quick Add → **Load Test Vehicle** |
| PUC countdown (green / amber / red) | `KA01AB1234` / `DL01EF9012` / `KA02CD5678` |
| ANPR challan discovery | `KA02CD5678` → 2 unpaid challans |
| Telegram deep-link pairing | Connect → `@VahanKavachDevBot` |
| Alert crons / dispatcher | `/simulate_alert` in Telegram or `send-puc-alert` |
| Fake Razorpay checkout | `rzp_test_*` keys only |

## 1. Web env

```bash
cp apps/web/.env.staging.example apps/web/.env.local
# Fill NEXT_PUBLIC_SUPABASE_ANON_KEY from Project Settings → API
```

Required public vars:

- `NEXT_PUBLIC_ENVIRONMENT=staging`
- `NEXT_PUBLIC_SUPABASE_URL=https://rygvtxqbhgteqgvmczxu.supabase.co`
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=VahanKavachDevBot`

## 2. Edge Function secrets

```bash
export STAGING_TELEGRAM_BOT_TOKEN="<token from BotFather for VahanKavachDevBot>"
chmod +x scripts/setup-sandbox-secrets.sh
./scripts/setup-sandbox-secrets.sh
```

Defaults: `VEHICLE_PROVIDER=MOCK`, mock Setu credentials, `rzp_test_xxxx`.

Switch to Setu sandbox (still free / non-prod):

```bash
VEHICLE_PROVIDER=SETU_SANDBOX \
  SETU_CLIENT_ID=... SETU_CLIENT_SECRET=... \
  ./scripts/setup-sandbox-secrets.sh
```

## 3. Deploy functions + migrate

```bash
supabase link --project-ref rygvtxqbhgteqgvmczxu
supabase db push
supabase functions deploy --project-ref rygvtxqbhgteqgvmczxu
```

Point Telegram webhook:

```bash
curl "https://api.telegram.org/bot${STAGING_TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://rygvtxqbhgteqgvmczxu.supabase.co/functions/v1/telegram-webhook"
```

## 4. Run the app

```bash
cd apps/web && npm install && npm run dev
```

You should see the sticky **Sandbox Environment** banner.

### Mock plates (chassis last-5 auto-filled by Load Test Vehicle)

| Plate | Chassis | Scenario |
|-------|---------|----------|
| `KA01AB1234` | `A1B2C` | Clean — PUC 180d, 0 challans |
| `KA02CD5678` | `C3D4E` | Urgent — PUC -5d, 2 ANPR challans |
| `DL01EF9012` | `E5F6G` | Warning — PUC 3d, ₹500 parking |

## 5. Smoke test

```bash
npm install
export SUPABASE_SERVICE_ROLE_KEY="<staging service role>"
export SANDBOX_TEST_USER_EMAIL="sandbox-tester@example.com"
export SANDBOX_TEST_USER_PASSWORD="choose-a-strong-password"
npx tsx scripts/verify-sandbox.ts
```

## Safety

- Never point this tree at production (`ssvkwqunozxrruyizvol`).
- Never set live Razorpay / Surepass production keys here.
- Staging Telegram alerts are prefixed with `[SANDBOX TEST ALERT]`.
