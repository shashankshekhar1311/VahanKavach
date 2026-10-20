# VahanKavach Android

Kotlin + Jetpack Compose client for the real **Supabase Cloud** project:

- Phone **SMS OTP** via Supabase Auth (`signInWith(OTP)` / `verifyPhoneOtp`)
- Garage PostgREST (`profiles`, `vehicles`, `challans`) with RLS
- Edge Function `sync-vehicle` for live compliance / challan sync
- Notification preferences + Telegram deep-link (`t.me/<bot>?start=<token>`)

## Prerequisites

1. [Android Studio](https://developer.android.com/studio) (Hedgehog+) or SDK + JDK 17
2. Cloud project: Phone Auth **enabled** + SMS provider (Twilio / MessageBird / Textlocal / Vonage)
3. Edge Functions deployed (`sync-vehicle`, `telegram-webhook`, …)

## Configure cloud credentials

```bash
cd apps/android
cp local.properties.example local.properties
```

Edit `local.properties`:

```properties
sdk.dir=C\:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
SUPABASE_URL=https://ssvkwqunozxrruyizvol.supabase.co
SUPABASE_ANON_KEY=<Project Settings → API → anon / publishable key>
TELEGRAM_BOT_NAME=<bot username without @>
```

Do **not** commit `local.properties`.

## Run

Open `apps/android` in Android Studio → Sync → Run on emulator/device.

Or CLI:

```bash
cd apps/android
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
./gradlew :app:installDebug
```

Debug APK path: `app/build/outputs/apk/debug/vahankavach.apk`

## Validate

```bash
./gradlew :app:testDebugUnitTest   # phone + registration helpers
./gradlew :app:assembleDebug       # compile APK
```

Manual smoke:

1. Launch app → enter real +91 mobile → receive SMS OTP → verify
2. Add plate (e.g. `KA01AB1234`) → Protect → vehicles appear from cloud
3. Notification Preferences → Telegram → Connect Telegram

## Cloud checklist (Auth OTP)

In Supabase Dashboard → **Authentication → Providers → Phone**:

- Enable Phone
- Configure SMS provider credentials
- Confirm rate limits / test number allowlist if using Twilio test mode

Dashboard → **Authentication → URL Configuration**: set Site URL if needed (mobile OTP does not require redirect).
