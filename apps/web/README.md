# VahanKavach Web Client (Module 5)

Mobile-first Next.js 15 App Router client for garage dashboard, phone OTP auth, vehicle protection via `sync-vehicle`, and challan settlement.

## Stack

- Next.js 15 (App Router) + React 19
- Tailwind CSS v4
- Lucide Icons
- `@supabase/supabase-js`

## Setup

```bash
# From repo root — ensure local Supabase is running
npx supabase start

# Install & run the web app
cd apps/web
npm install
cp .env.local.example .env.local   # if needed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The UI is optimized for ≤480px width and centers on desktop.

### Environment

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Local API URL (`http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon JWT from `npx supabase status` |
| `NEXT_PUBLIC_UPI_VPA` | Optional UPI VPA for pay deep-links |

## Test credentials (local seed)

From `supabase/seed.sql`:

| Field | Value |
|---|---|
| Email | `aarav.mehta@vahankavach.test` |
| Password | `TestPassword123!` |
| Phone (profile) | `+919876543210` |

**Demo login:** On `/login`, use **Continue with local demo account** (email/password against the seed user). This works without an SMS provider.

**Phone OTP:** Requires Phone auth + SMS provider in Supabase (Twilio / MessageBird, or hosted project). Flow: `signInWithOtp({ phone })` → 6-digit `verifyOtp`.

### Seed vehicles

| Plate | Model | Notes |
|---|---|---|
| `KA01AB1234` | Maruti Suzuki Baleno | PUC ~T-7 |
| `MH12CD5678` | Hyundai Creta | 2 unpaid challans (₹2,500) |
| `DL01EX0001` | Tata Nexon | PUC ~T-1 |
| `TS09EX0002` | Honda City | PUC expires today |

## Screens

1. **`/login`** — +91 phone OTP (+ demo account shortcut)
2. **`/dashboard`** — Garage, quick-add → `sync-vehicle`, PUC gauge, challan widget
3. **Challan drawer** — Unpaid list, evidence link, `upi://pay?...` / Parivahan portal

## Scripts

```bash
npm run dev      # turbopack
npm run build
npm run start
npm run lint
```
