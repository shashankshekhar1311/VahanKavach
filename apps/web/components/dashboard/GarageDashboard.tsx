"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { MobileShell } from "@/components/ui/MobileShell";
import { Spinner } from "@/components/ui/Spinner";
import { DashboardHeader } from "./DashboardHeader";
import { PricingModal } from "@/components/PricingModal";
import {
  BillingPanel,
  type BillingSnapshot,
} from "./BillingPanel";
import { NotificationPreferences } from "./NotificationPreferences";
import { QuickAddVehicle } from "./QuickAddVehicle";
import { VehicleCard } from "./VehicleCard";
import { ChallanDrawer } from "./ChallanDrawer";

import {
  CONSENT_PURPOSE,
  CONSENT_TEXT_VERSION,
} from "@/lib/consent";
import { toStoredRegNumber } from "@/lib/registration";
import { supabase } from "@/lib/supabase";
import type {
  Challan,
  SyncVehicleApiResponse,
  Vehicle,
  VehicleWithChallans,
} from "@/lib/types";

export function GarageDashboard() {
  const { profile, refreshProfile, signOut, user } = useAuth();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<VehicleWithChallans[]>([]);
  const [loading, setLoading] = useState(true);
  const [protecting, setProtecting] = useState(false);
  const [refreshingReg, setRefreshingReg] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [drawerVehicle, setDrawerVehicle] = useState<Vehicle | null>(null);
  const [billingQtyHint, setBillingQtyHint] = useState<number | undefined>();
  const [pricingOpen, setPricingOpen] = useState(false);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);

  const isSubscribed = Boolean(profile?.is_pro || billing?.isActive);
  const hasVehicles = vehicles.length > 0;

  const onBillingSnapshot = useCallback((snap: BillingSnapshot) => {
    setBilling(snap);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const [{ data: subRow }, { data: ents }] = await Promise.all([
        supabase
          .from("subscriptions")
          .select("status, vehicle_qty, trial_ends_at, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("vehicle_entitlements")
          .select("vehicle_id, active_until")
          .eq("user_id", user.id),
      ]);
      if (cancelled) return;
      const now = Date.now();
      const periodEnd =
        (subRow as { current_period_end?: string | null; trial_ends_at?: string | null } | null)
          ?.current_period_end ??
        (subRow as { trial_ends_at?: string | null } | null)?.trial_ends_at ??
        null;
      const periodOk =
        Boolean(periodEnd) && new Date(periodEnd!).getTime() > now;
      const status =
        (subRow as { status?: string } | null)?.status ?? null;
      const isActive =
        Boolean(profile?.is_pro) ||
        (periodOk &&
          (status === "active" || status === "trial" || status === "past_due"));
      const entitled = (
        (ents ?? []) as Array<{ active_until: string }>
      ).filter((e) => new Date(e.active_until).getTime() > now).length;
      setBilling({
        isActive,
        status,
        vehicleQty:
          (subRow as { vehicle_qty?: number } | null)?.vehicle_qty ?? 0,
        entitled,
        periodEnd,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profile?.is_pro, vehicles.length]);

  const loadGarage = useCallback(async () => {
    if (!user) return;

    const { data: vehicleRows, error: vehicleError } = await supabase
      .from("vehicles")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (vehicleError) {
      setBanner(vehicleError.message);
      setLoading(false);
      return;
    }

    const list = (vehicleRows ?? []) as Vehicle[];
    if (list.length === 0) {
      setVehicles([]);
      setLoading(false);
      return;
    }

    const ids = list.map((v) => v.id);
    const { data: challanRows, error: challanError } = await supabase
      .from("challans")
      .select("*")
      .in("vehicle_id", ids);

    if (challanError) {
      setBanner(challanError.message);
    }

    const challans = (challanRows ?? []) as Challan[];
    setVehicles(
      list.map((v) => ({
        ...v,
        challans: challans.filter((c) => c.vehicle_id === v.id),
      })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void loadGarage();
  }, [loadGarage]);

  async function invokeSync(
    regInput: string,
    options: {
      forceRefresh?: boolean;
      mode?: "claim" | "refresh";
      chassisLast5?: string;
    } = {},
  ) {
    const regNumber = toStoredRegNumber(regInput) ?? regInput;
    const { data, error } = await supabase.functions.invoke("sync-vehicle", {
      body: {
        regNumber,
        forceRefresh: options.forceRefresh ?? false,
        mode: options.mode,
        chassisLast5: options.chassisLast5,
      },
    });

    let payload = data as SyncVehicleApiResponse | null;

    if (error) {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          payload = (await ctx.json()) as SyncVehicleApiResponse;
        } catch {
          /* keep payload as-is */
        }
      }
      throw new Error(
        payload?.error || error.message || "sync-vehicle failed",
      );
    }

    if (!payload?.success) {
      throw new Error(payload?.error ?? "Could not sync vehicle");
    }

    return payload;
  }

  async function recordProtectConsent(regInput: string) {
    if (!user) return;

    const stored = toStoredRegNumber(regInput) ?? regInput;
    const { data: vehicle, error: lookupError } = await supabase
      .from("vehicles")
      .select("id")
      .eq("reg_number", stored)
      .maybeSingle();

    if (lookupError || !vehicle?.id) {
      console.error("consent vehicle lookup failed", lookupError?.message);
      return;
    }

    const { error: consentError } = await supabase
      .from("consent_audit_logs")
      .insert({
        user_id: user.id,
        vehicle_id: vehicle.id,
        purpose: CONSENT_PURPOSE,
        consent_text_version: CONSENT_TEXT_VERSION,
        ip_address: null,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
      });

    if (consentError) {
      console.error("consent_audit_logs insert failed", consentError.message);
    }
  }

  async function handleProtect(regNumber: string, chassisLast5: string) {
    setProtecting(true);
    setBanner(null);
    try {
      await invokeSync(regNumber, {
        mode: "claim",
        chassisLast5,
        forceRefresh: false,
      });
      await recordProtectConsent(regNumber);
      setBanner("Vehicle claimed and protected — compliance synced.");
      await loadGarage();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Protect failed";
      setBanner(message);
      const qtyMatch = message.match(/vehicle #(\d+)/i);
      if (qtyMatch) setBillingQtyHint(Number(qtyMatch[1]));
      if (/payment required/i.test(message)) {
        setBillingQtyHint((q) => q ?? vehicles.length + 1);
        if (!isSubscribed) setPricingOpen(true);
      }
      throw err;
    } finally {
      setProtecting(false);
    }
  }

  async function handleRefresh(regNumber: string) {
    setRefreshingReg(regNumber);
    setBanner(null);
    try {
      await invokeSync(regNumber, { mode: "refresh", forceRefresh: true });
      setBanner("Compliance refreshed from upstream.");
      await loadGarage();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingReg(null);
    }
  }

  async function handleRelease(vehicle: Vehicle) {
    setReleasingId(vehicle.id);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("vehicles")
        .delete()
        .eq("id", vehicle.id);
      if (error) throw error;
      setBanner(
        `${vehicle.reg_number} released. A new owner can now claim it with chassis proof.`,
      );
      await loadGarage();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Release failed");
    } finally {
      setReleasingId(null);
    }
  }

  async function handleRefreshAll() {
    setLoading(true);
    setBanner(null);
    try {
      for (const v of vehicles) {
        await invokeSync(v.reg_number, { mode: "refresh", forceRefresh: true });
      }
      await loadGarage();
      setBanner(
        vehicles.length > 0
          ? "All vehicles force-synced."
          : "Garage is empty — add a registration.",
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Sync failed");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const drawerChallans =
    vehicles.find((v) => v.id === drawerVehicle?.id)?.challans ?? [];

  const vehicleList = loading ? (
    <div className="flex justify-center py-16">
      <Spinner className="h-8 w-8 text-safety" />
    </div>
  ) : vehicles.length === 0 ? (
    <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-10 text-center">
      <p className="text-sm font-medium text-zinc-300">No vehicles yet</p>
      <p className="mt-1 text-xs text-zinc-500">
        {isSubscribed
          ? "Add a registration to start monitoring."
          : "Enter a registration above to start protection."}
      </p>
    </div>
  ) : (
    <div className="flex flex-col gap-5">
      {vehicles.map((vehicle) => (
        <VehicleCard
          key={vehicle.id}
          vehicle={vehicle}
          challans={vehicle.challans}
          refreshing={refreshingReg === vehicle.reg_number}
          releasing={releasingId === vehicle.id}
          onRefresh={(reg) => void handleRefresh(reg)}
          onRelease={(v) => void handleRelease(v)}
          onViewChallans={setDrawerVehicle}
        />
      ))}
    </div>
  );

  return (
    <MobileShell>
      <DashboardHeader profile={profile} onSignOut={handleSignOut} />

      <div className="mt-3 space-y-3">
        {banner && (
          <p
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
            role="status"
          >
            {banner}
          </p>
        )}

        {isSubscribed ? (
          <>
            <BillingPanel
              vehicleCount={vehicles.length}
              suggestedQty={billingQtyHint}
              mode="manage"
              onSnapshot={onBillingSnapshot}
            />

            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-200">
                Your vehicles
                {hasVehicles ? (
                  <span className="ml-1.5 font-normal text-zinc-500">
                    ({vehicles.length})
                  </span>
                ) : null}
              </h2>
              {hasVehicles ? (
                <button
                  type="button"
                  onClick={() => void handleRefreshAll()}
                  disabled={loading || protecting}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-safety disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh all
                </button>
              ) : null}
            </div>

            {vehicleList}

            <QuickAddVehicle
              onProtect={handleProtect}
              busy={protecting}
              collapsed={hasVehicles}
              defaultOpen={!hasVehicles}
            />

            <NotificationPreferences profile={profile} />
          </>
        ) : (
          <>
            <QuickAddVehicle
              onProtect={handleProtect}
              busy={protecting}
              collapsed={false}
              defaultOpen
            />

            <button
              type="button"
              onClick={() => setPricingOpen(true)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-safety/30 bg-gradient-to-r from-safety/15 to-zinc-900/80 px-3 py-2.5 text-left transition hover:border-safety/50"
            >
              <span>
                <span className="block text-sm font-semibold text-zinc-50">
                  Unlock Kavach Pro
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">
                  ANPR challan alerts · daily PUC · ₹1/day · ₹329/vehicle/year
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-safety px-2.5 py-1.5 text-[11px] font-semibold text-zinc-950">
                Upgrade
              </span>
            </button>

            <NotificationPreferences profile={profile} />

            <div className="flex items-center justify-between pt-0.5">
              <h2 className="text-sm font-semibold text-zinc-300">
                Your vehicles
              </h2>
              <button
                type="button"
                onClick={() => void handleRefreshAll()}
                disabled={loading || protecting}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-safety disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                />
                Refresh all
              </button>
            </div>

            {vehicleList}
          </>
        )}
      </div>

      <ChallanDrawer
        open={drawerVehicle !== null}
        onClose={() => setDrawerVehicle(null)}
        vehicle={drawerVehicle}
        challans={drawerChallans}
        onPaidExternally={() => void loadGarage()}
      />

      <PricingModal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        vehicleQty={Math.max(vehicles.length, billingQtyHint ?? 1, 1)}
        onActivated={() => {
          void refreshProfile();
          setPricingOpen(false);
          setBanner("Kavach Pro activated — ₹329/vehicle/year cover is on.");
        }}
      />
    </MobileShell>
  );
}
