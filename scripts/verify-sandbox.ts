/**
 * Automated sandbox smoke test against the staging Supabase project.
 *
 * Usage:
 *   npx tsx scripts/verify-sandbox.ts
 *
 * Required env (apps/web/.env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SANDBOX_TEST_USER_EMAIL
 *   SANDBOX_TEST_USER_PASSWORD
 *
 * Optional:
 *   SANDBOX_TEST_PLATE (default KA02CD5678)
 *   SANDBOX_TEST_CHASSIS (default C3D4E)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TEST_PLATE = (process.env.SANDBOX_TEST_PLATE ?? "KA02CD5678")
  .replace(/[\s-]/g, "")
  .toUpperCase();
const TEST_CHASSIS = (process.env.SANDBOX_TEST_CHASSIS ?? "C3D4E")
  .replace(/[^A-Za-z0-9]/g, "")
  .toUpperCase()
  .slice(-5);

type StepResult = { name: string; ok: boolean; detail?: string };

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function log(msg: string): void {
  console.log(msg);
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`✗ ${msg}`);
}

async function main(): Promise<void> {
  loadEnvFile(resolve(ROOT, "apps/web/.env.local"));
  loadEnvFile(resolve(ROOT, "apps/web/.env.staging"));
  loadEnvFile(resolve(ROOT, ".env"));

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const email = requireEnv("SANDBOX_TEST_USER_EMAIL");
  const password = requireEnv("SANDBOX_TEST_USER_PASSWORD");

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Set SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL and anon key for staging.",
    );
  }

  if (!supabaseUrl.includes("rygvtxqbhgteqgvmczxu") && !supabaseUrl.includes("127.0.0.1")) {
    console.warn(
      `! URL ${supabaseUrl} does not look like staging project rygvtxqbhgteqgvmczxu — continuing anyway.`,
    );
  }

  const results: StepResult[] = [];

  log("=== VahanKavach sandbox verify ===");
  log(`url: ${supabaseUrl}`);
  log(`plate: ${TEST_PLATE} / chassis: ${TEST_CHASSIS}`);
  log("");

  // 1) Database connection (service role)
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: pingError } = await admin.from("profiles").select("id").limit(1);
  if (pingError) {
    fail(`Database connection failed: ${pingError.message}`);
    results.push({ name: "db", ok: false, detail: pingError.message });
    process.exit(1);
  }
  ok("Database connection to staging project");
  results.push({ name: "db", ok: true });

  // 2) Auth as sandbox tester
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signIn.session) {
    log("… creating sandbox test user (sign-up)");
    const { data: signedUp, error: signUpError } = await userClient.auth.signUp({
      email,
      password,
    });
    if (signUpError) {
      fail(`Auth failed: ${signUpError.message}`);
      results.push({ name: "auth", ok: false, detail: signUpError.message });
      process.exit(1);
    }
    if (!signedUp.session) {
      // Email confirm may be required — use admin to confirm + sign in again.
      const userId = signedUp.user?.id;
      if (userId) {
        await admin.auth.admin.updateUserById(userId, {
          email_confirm: true,
        });
      }
      ({ data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
        email,
        password,
      }));
    } else {
      signIn = signedUp;
    }
  }

  if (signInError || !signIn.session || !signIn.user) {
    fail(`Could not authenticate sandbox user: ${signInError?.message ?? "no session"}`);
    results.push({ name: "auth", ok: false, detail: signInError?.message });
    process.exit(1);
  }

  ok(`Authenticated as ${email} (${signIn.user.id})`);
  results.push({ name: "auth", ok: true });

  const accessToken = signIn.session.access_token;
  const userId = signIn.user.id;

  // Ensure profile row exists
  await admin.from("profiles").upsert(
    {
      id: userId,
      preferred_channel: "TELEGRAM",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  // Clean prior fixture ownership if leftover from earlier runs (same user only)
  const { data: prior } = await admin
    .from("vehicles")
    .select("id, user_id")
    .eq("reg_number", TEST_PLATE)
    .maybeSingle();

  if (prior && prior.user_id === userId) {
    await admin.from("challans").delete().eq("vehicle_id", prior.id);
    await admin.from("vehicle_entitlements").delete().eq("vehicle_id", prior.id);
    await admin.from("vehicles").delete().eq("id", prior.id);
    ok(`Cleaned prior fixture ${TEST_PLATE}`);
  } else if (prior && prior.user_id !== userId) {
    fail(
      `Plate ${TEST_PLATE} owned by another user (${prior.user_id}). Release it in staging first.`,
    );
    process.exit(1);
  }

  // 3) Simulate adding test plate via sync-vehicle (claim)
  const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-vehicle`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      regNumber: TEST_PLATE,
      mode: "claim",
      chassisLast5: TEST_CHASSIS,
      forceRefresh: true,
    }),
  });

  const syncJson = (await syncRes.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: {
      vehicle?: { regNumber?: string; puc?: { daysRemaining?: number } };
      challans?: unknown[];
    };
  } | null;

  if (!syncRes.ok || !syncJson?.success) {
    fail(
      `sync-vehicle failed (${syncRes.status}): ${syncJson?.error ?? syncRes.statusText}`,
    );
    results.push({
      name: "sync-vehicle",
      ok: false,
      detail: syncJson?.error ?? String(syncRes.status),
    });
    process.exit(1);
  }

  ok(
    `sync-vehicle claimed ${TEST_PLATE} (challans in response: ${
      syncJson.data?.challans?.length ?? 0
    })`,
  );
  results.push({ name: "sync-vehicle", ok: true });

  // 4) Verify DB persistence + FKs
  const { data: vehicle, error: vehicleError } = await admin
    .from("vehicles")
    .select("id, user_id, reg_number, puc_expiry_date, maker_model")
    .eq("reg_number", TEST_PLATE)
    .eq("user_id", userId)
    .maybeSingle();

  if (vehicleError || !vehicle) {
    fail(`Vehicle row missing: ${vehicleError?.message ?? "not found"}`);
    results.push({ name: "vehicle-row", ok: false });
    process.exit(1);
  }

  ok(`Vehicle persisted id=${vehicle.id} user_id=${vehicle.user_id}`);

  const { data: challans, error: challanError } = await admin
    .from("challans")
    .select("id, vehicle_id, challan_number, amount, status")
    .eq("vehicle_id", vehicle.id)
    .eq("status", "UNPAID");

  if (challanError) {
    fail(`Challan query failed: ${challanError.message}`);
    results.push({ name: "challans", ok: false, detail: challanError.message });
    process.exit(1);
  }

  const unpaid = challans ?? [];
  const expectedChallans = TEST_PLATE === "KA02CD5678" ? 2 : unpaid.length;
  if (TEST_PLATE === "KA02CD5678" && unpaid.length !== 2) {
    fail(`Expected 2 unpaid challans for KA02CD5678, got ${unpaid.length}`);
    results.push({
      name: "challans",
      ok: false,
      detail: `count=${unpaid.length}`,
    });
    process.exit(1);
  }

  const badFk = unpaid.find((c) => c.vehicle_id !== vehicle.id);
  if (badFk) {
    fail(`Challan FK mismatch: ${badFk.challan_number}`);
    process.exit(1);
  }

  ok(
    `Persisted ${unpaid.length} unpaid challan(s) with correct vehicle_id FK` +
      (expectedChallans === 2 ? " (KA02CD5678 fixture OK)" : ""),
  );
  results.push({ name: "challans", ok: true, detail: `count=${unpaid.length}` });

  // Ensure entitlement so send-puc-alert does not 402
  const activeUntil = new Date();
  activeUntil.setUTCDate(activeUntil.getUTCDate() + 30);
  await admin.from("vehicle_entitlements").upsert(
    {
      vehicle_id: vehicle.id,
      user_id: userId,
      active_until: activeUntil.toISOString(),
      source: "admin_grant",
    },
    { onConflict: "vehicle_id" },
  );

  // 5) Dispatch test PUC alert
  const alertRes = await fetch(`${supabaseUrl}/functions/v1/send-puc-alert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vehicleId: vehicle.id,
      daysLeft: 0,
      alertKind: "PUC",
    }),
  });

  const alertJson = (await alertRes.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: {
      channel?: string;
      messageId?: string | null;
      urgency?: string;
    };
  } | null;

  log("");
  log("--- send-puc-alert response ---");
  log(JSON.stringify(alertJson, null, 2));
  log(`HTTP ${alertRes.status}`);

  // 422 is acceptable when Telegram is not linked yet — still proves the path runs.
  if (alertRes.status === 422) {
    ok(
      `send-puc-alert reached dispatcher gate (${alertJson?.error ?? "no telegram/phone"}) — link @VahanKavachDevBot to fully deliver`,
    );
    results.push({
      name: "send-puc-alert",
      ok: true,
      detail: alertJson?.error ?? "422 expected without telegram",
    });
  } else if (alertRes.ok && alertJson?.success) {
    ok(
      `send-puc-alert dispatched via ${alertJson.data?.channel ?? "?"} urgency=${
        alertJson.data?.urgency ?? "?"
      } messageId=${alertJson.data?.messageId ?? "n/a"}`,
    );
    results.push({ name: "send-puc-alert", ok: true });
  } else {
    fail(
      `send-puc-alert failed (${alertRes.status}): ${alertJson?.error ?? alertRes.statusText}`,
    );
    results.push({
      name: "send-puc-alert",
      ok: false,
      detail: alertJson?.error ?? String(alertRes.status),
    });
    process.exit(1);
  }

  log("");
  log("=== Summary ===");
  for (const r of results) {
    log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  ok("Sandbox smoke test complete");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// Silence unused-type lint if tooling checks this file in isolation.
void (null as unknown as SupabaseClient);
