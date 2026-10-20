"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { MobileShell } from "@/components/ui/MobileShell";
import { Spinner } from "@/components/ui/Spinner";
import { DashboardHeader } from "./DashboardHeader";
import { NotificationPreferences } from "./NotificationPreferences";
import { QuickAddVehicle } from "./QuickAddVehicle";
import { VehicleCard } from "./VehicleCard";
import { ChallanDrawer } from "./ChallanDrawer";
import { supabase } from "@/lib/supabase";
import { toStoredRegNumber } from "@/lib/registration";
import type {
  Challan,
  SyncVehicleApiResponse,
  Vehicle,
  VehicleWithChallans,
} from "@/lib/types";

export function GarageDashboard() {
  const { profile, signOut, user } = useAuth();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<VehicleWithChallans[]>([]);
  const [loading, setLoading] = useState(true);
  const [protecting, setProtecting] = useState(false);
  const [refreshingReg, setRefreshingReg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [drawerVehicle, setDrawerVehicle] = useState<Vehicle | null>(null);

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

  async function invokeSync(regInput: string, forceRefresh = false) {
    const regNumber = toStoredRegNumber(regInput) ?? regInput;
    const { data, error } = await supabase.functions.invoke("sync-vehicle", {
      body: { regNumber, forceRefresh },
    });

    let payload = data as SyncVehicleApiResponse | null;

    if (error) {
      // Non-2xx: body is often on error.context (Response), not in `data`.
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

  async function handleProtect(regNumber: string) {
    setProtecting(true);
    setBanner(null);
    try {
      await invokeSync(regNumber, false);
      setBanner("Vehicle protected — compliance synced.");
      await loadGarage();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Protect failed";
      setBanner(message);
      throw err;
    } finally {
      setProtecting(false);
    }
  }

  async function handleRefresh(regNumber: string) {
    setRefreshingReg(regNumber);
    setBanner(null);
    try {
      await invokeSync(regNumber, true);
      setBanner("Compliance refreshed from upstream.");
      await loadGarage();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingReg(null);
    }
  }

  async function handleRefreshAll() {
    setLoading(true);
    setBanner(null);
    try {
      for (const v of vehicles) {
        await invokeSync(v.reg_number, true);
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

  return (
    <MobileShell>
      <DashboardHeader profile={profile} onSignOut={handleSignOut} />

      <div className="mt-3 space-y-3">
        <QuickAddVehicle onProtect={handleProtect} busy={protecting} />

        <NotificationPreferences profile={profile} />

        <div className="flex items-center justify-between pt-0.5">
          <h2 className="text-sm font-semibold text-zinc-300">Your vehicles</h2>
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

        {banner && (
          <p
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
            role="status"
          >
            {banner}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-8 w-8 text-safety" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-12 text-center">
            <p className="text-sm font-medium text-zinc-300">No vehicles yet</p>
            <p className="mt-1 text-xs text-zinc-500">
              Enter a registration above to start protection.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                challans={vehicle.challans}
                refreshing={refreshingReg === vehicle.reg_number}
                onRefresh={(reg) => void handleRefresh(reg)}
                onViewChallans={setDrawerVehicle}
              />
            ))}
          </div>
        )}
      </div>

      <ChallanDrawer
        open={drawerVehicle !== null}
        onClose={() => setDrawerVehicle(null)}
        vehicle={drawerVehicle}
        challans={drawerChallans}
      />
    </MobileShell>
  );
}
