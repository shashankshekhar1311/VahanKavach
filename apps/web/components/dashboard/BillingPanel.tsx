"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Spinner } from "@/components/ui/Spinner";
import {
  ANNUAL_PREPAID_RUPEES_PER_VEHICLE,
  annualTotalRupees,
  pricingSubcopy,
} from "@/lib/pricing";
import { loadRazorpayCheckout } from "@/lib/razorpay";
import { supabase } from "@/lib/supabase";

interface SubscriptionRow {
  status: string;
  vehicle_qty: number;
  trial_ends_at: string | null;
  current_period_end: string | null;
  amount_paise_per_vehicle: number;
}

interface EntitlementRow {
  vehicle_id: string;
  active_until: string;
  source: string;
}

export interface BillingSnapshot {
  isActive: boolean;
  status: string | null;
  vehicleQty: number;
  entitled: number;
  periodEnd: string | null;
}

interface BillingPanelProps {
  vehicleCount: number;
  suggestedQty?: number;
  /** Upsell for non-subscribers; manage = compact renew / change plan. */
  mode?: "upsell" | "manage";
  onSnapshot?: (snap: BillingSnapshot) => void;
  onOpenPricing?: () => void;
}

export function BillingPanel({
  vehicleCount,
  suggestedQty,
  mode = "upsell",
  onSnapshot,
  onOpenPricing,
}: BillingPanelProps) {
  const { user, profile } = useAuth();
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [entitled, setEntitled] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [qty, setQty] = useState(Math.max(suggestedQty ?? vehicleCount, 1));
  const [changing, setChanging] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    const [{ data: subRow }, { data: ents }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select(
          "status, vehicle_qty, trial_ends_at, current_period_end, amount_paise_per_vehicle",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("vehicle_entitlements")
        .select("vehicle_id, active_until, source")
        .eq("user_id", user.id),
    ]);
    const row = (subRow as SubscriptionRow | null) ?? null;
    setSub(row);
    const now = Date.now();
    const active = ((ents ?? []) as EntitlementRow[]).filter(
      (e) => new Date(e.active_until).getTime() > now,
    );
    setEntitled(active.length);

    const periodEnd = row?.current_period_end ?? row?.trial_ends_at ?? null;
    const periodOk =
      Boolean(periodEnd) && new Date(periodEnd!).getTime() > now;
    const isActive =
      Boolean(profile?.is_pro) ||
      (periodOk &&
        (row?.status === "active" ||
          row?.status === "trial" ||
          row?.status === "past_due"));

    onSnapshot?.({
      isActive,
      status: row?.status ?? null,
      vehicleQty: row?.vehicle_qty ?? 0,
      entitled: active.length,
      periodEnd,
    });
  }, [user, profile?.is_pro, onSnapshot]);

  useEffect(() => {
    void reload();
  }, [reload, vehicleCount]);

  useEffect(() => {
    setQty(Math.max(suggestedQty ?? vehicleCount, vehicleCount, 1));
  }, [suggestedQty, vehicleCount]);

  async function handleCheckout() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-billing-checkout",
        { body: { vehicleQty: qty } },
      );
      const payload = data as {
        success?: boolean;
        error?: string;
        data?: {
          mock?: boolean;
          orderId?: string;
          amountPaise?: number;
          keyId?: string;
          description?: string;
          periodEnd?: string;
          message?: string;
        };
      } | null;

      if (error) {
        throw new Error(payload?.error || error.message);
      }
      if (!payload?.success || !payload.data) {
        throw new Error(payload?.error ?? "Checkout failed");
      }

      if (payload.data.mock) {
        setMessage(
          payload.data.message ??
            `Cover active until ${payload.data.periodEnd ?? "period end"}.`,
        );
        setChanging(false);
        await reload();
        return;
      }

      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error("Razorpay unavailable");

      const rzp = new window.Razorpay({
        key: payload.data.keyId,
        amount: payload.data.amountPaise,
        currency: "INR",
        name: "VahanKavach",
        description: payload.data.description,
        order_id: payload.data.orderId,
        prefill: {
          email: user.email ?? undefined,
          contact: profile?.phone_number ?? undefined,
        },
        handler: async () => {
          setMessage("Payment received — updating your plan…");
          setChanging(false);
          window.setTimeout(() => void reload(), 2500);
        },
      });
      rzp.open();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  const periodEnd = sub?.current_period_end ?? sub?.trial_ends_at;
  const periodLabel = periodEnd
    ? new Date(periodEnd).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const total = annualTotalRupees(qty);
  const covered = sub?.vehicle_qty ?? 0;

  if (mode === "manage") {
    return (
      <section className="rounded-xl border border-safety/25 bg-safety/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-safety/40 bg-safety/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-safety">
                Pro
              </span>
              <span className="text-[11px] text-zinc-300">
                {entitled}/{vehicleCount} vehicles covered
                {covered > 0 ? ` · plan for ${covered}` : ""}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              {periodLabel
                ? `Renews / ends ${periodLabel}`
                : "Annual prepaid active"}
              {" · "}₹{ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/vehicle/year
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setQty(Math.max(vehicleCount, covered, 1));
                setChanging(false);
                void handleCheckout();
              }}
              className="rounded-lg border border-safety/40 bg-safety/15 px-2.5 py-1.5 text-[11px] font-semibold text-safety transition hover:bg-safety/25 disabled:opacity-50"
            >
              {busy && !changing ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                "Renew"
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setChanging((c) => !c);
                setQty(Math.max(vehicleCount + 1, covered, 1));
              }}
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-50"
            >
              Change plan
            </button>
          </div>
        </div>

        {changing ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-safety/15 pt-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              Vehicles
              <input
                type="number"
                min={Math.max(vehicleCount, 1)}
                max={50}
                value={qty}
                disabled={busy}
                onChange={(e) =>
                  setQty(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-14 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-100"
              />
            </label>
            <span className="text-[11px] text-zinc-500">₹{total}/year</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCheckout()}
              className="inline-flex items-center gap-1 rounded-lg bg-safety px-2.5 py-1.5 text-[11px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              Confirm
            </button>
          </div>
        ) : null}

        {message ? (
          <p className="mt-1.5 text-[11px] text-zinc-400" role="status">
            {message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-safety" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">
              Billing · ₹1/day per vehicle
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              {sub?.status ?? "no plan"} · {entitled}/{vehicleCount} entitled
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Annual prepaid ₹{ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/vehicle/year —{" "}
            {pricingSubcopy(1)}.
            {periodLabel ? ` Current window ends ${periodLabel}.` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              Vehicles
              <input
                type="number"
                min={Math.max(vehicleCount, 1)}
                max={50}
                value={qty}
                disabled={busy}
                onChange={(e) =>
                  setQty(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-14 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-100"
              />
            </label>
            <span className="text-[11px] text-zinc-500">₹{total} / year</span>
            <button
              type="button"
              disabled={busy || !user}
              onClick={() => {
                if (onOpenPricing) onOpenPricing();
                else void handleCheckout();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-safety px-2.5 py-1.5 text-[11px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <CreditCard className="h-3.5 w-3.5" />
              )}
              Pay yearly
            </button>
          </div>
          {message && (
            <p className="mt-1.5 text-[11px] text-zinc-400" role="status">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
