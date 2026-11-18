"use client";

import { useEffect, useState } from "react";
import {
  BellRing,
  Camera,
  Check,
  Gauge,
  Shield,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Spinner } from "@/components/ui/Spinner";
import {
  ANNUAL_PREPAID_RUPEES_PER_VEHICLE,
  FLEET_PASS_DAYS,
  planTotalRupees,
  type PlanTier,
} from "@/lib/pricing";
import {
  loadRazorpayCheckout,
  type RazorpaySuccessResponse,
} from "@/lib/razorpay";
import { supabase } from "@/lib/supabase";

export type CheckoutTier = Exclude<PlanTier, "free">;

const TIER_COPY: Record<
  CheckoutTier,
  {
    eyebrow: string;
    title: string;
    body: string;
    benefits: Array<{ icon: typeof Zap; title: string; body: string }>;
  }
> = {
  adhoc_audit: {
    eyebrow: "Ad-hoc Audit",
    title: "Live sync credits",
    body: "₹19 per credit — one paid VAHAN + challan pull each. Buy as many as you need.",
    benefits: [
      {
        icon: Zap,
        title: "1 credit = 1 live sync",
        body: "Burns one credit on each live Protect / refresh.",
      },
      {
        icon: Shield,
        title: "Same ownership proof",
        body: "Chassis last-5 still required — no full VIN stored.",
      },
    ],
  },
  fleet_pass: {
    eyebrow: "Fleet Pass",
    title: `${FLEET_PASS_DAYS}-day burst cover`,
    body: "₹99 per vehicle for a week of live sync — short trips or fleet spikes.",
    benefits: [
      {
        icon: Gauge,
        title: "Per-vehicle burst window",
        body: `Full live sync for ${FLEET_PASS_DAYS} days on each vehicle you cover.`,
      },
      {
        icon: BellRing,
        title: "Keep alerts running",
        body: "Telegram / WhatsApp preferences stay as configured.",
      },
    ],
  },
  pro_annual: {
    eyebrow: "Kavach Pro",
    title: "Annual prepaid",
    body: "Onboard once, then challans checked every 10 days — we alert you when something new shows up.",
    benefits: [
      {
        icon: Camera,
        title: "Challan check every 10 days",
        body: "Scheduled e-challan polls; alert on Telegram when a new challan is found.",
      },
      {
        icon: BellRing,
        title: "Cached RC · PUC · insurance",
        body: "Pulled at onboard; refreshed when documents expire — not on every open.",
      },
      {
        icon: Shield,
        title: "Per-vehicle annual cover",
        body: `₹${ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/year · includes future WhatsApp alerts in plan.`,
      },
    ],
  },
};

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  vehicleQty?: number;
  initialTier?: CheckoutTier;
  onActivated?: (tier: CheckoutTier) => void;
}

export function PricingModal({
  open,
  onClose,
  vehicleQty = 1,
  initialTier = "pro_annual",
  onActivated,
}: PricingModalProps) {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [qty, setQty] = useState(Math.max(1, vehicleQty));
  const [tier, setTier] = useState<CheckoutTier>(initialTier);

  useEffect(() => {
    if (open) {
      setQty(Math.max(1, vehicleQty));
      setTier(initialTier);
      setError(null);
      setSuccess(false);
    }
  }, [open, vehicleQty, initialTier]);

  if (!open) return null;

  const copy = TIER_COPY[tier];
  const total = planTotalRupees(tier, qty);
  const qtyLabel =
    tier === "adhoc_audit"
      ? `${qty} credit${qty > 1 ? "s" : ""}`
      : `${qty} vehicle${qty > 1 ? "s" : ""}`;

  async function startCheckout() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "create-order",
        {
          body: {
            tier,
            vehicleQty: qty,
          },
        },
      );

      let payload = data as {
        success?: boolean;
        error?: string;
        data?: {
          orderId?: string;
          amount?: number;
          keyId?: string;
          currency?: string;
          mock?: boolean;
          description?: string;
          periodEnd?: string;
        };
      } | null;

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            payload = (await ctx.json()) as typeof payload;
          } catch {
            /* ignore */
          }
        }
        throw new Error(payload?.error || fnError.message || "create-order failed");
      }

      if (!payload?.success || !payload.data?.orderId) {
        throw new Error(payload?.error ?? "Could not create order");
      }

      if (payload.data.mock) {
        await refreshProfile();
        setSuccess(true);
        onActivated?.(tier);
        return;
      }

      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error("Razorpay Checkout unavailable");

      const isMobile =
        typeof navigator !== "undefined" &&
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      const rzp = new window.Razorpay({
        key: payload.data.keyId,
        amount: payload.data.amount,
        currency: payload.data.currency ?? "INR",
        name: "VahanKavach",
        description: payload.data.description ?? copy.title,
        order_id: payload.data.orderId,
        prefill: {
          contact: profile?.phone_number ?? undefined,
          email: user.email ?? undefined,
          method: isMobile ? "upi" : undefined,
        },
        theme: { color: "#10b981" },
        handler: async (response: RazorpaySuccessResponse) => {
          try {
            const { data: verifyData, error: verifyError } =
              await supabase.functions.invoke("verify-order", {
                body: {
                  orderId: response.razorpay_order_id,
                  paymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature,
                },
              });

            const verifyPayload = verifyData as {
              success?: boolean;
              error?: string;
            } | null;

            if (verifyError || !verifyPayload?.success) {
              throw new Error(
                verifyPayload?.error ||
                  verifyError?.message ||
                  "Payment verification failed",
              );
            }

            await refreshProfile();
            setSuccess(true);
            onActivated?.(tier);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Payment captured but verification failed.",
            );
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });

      rzp.on("payment.failed", (resp: unknown) => {
        const detail = resp as {
          error?: { description?: string; reason?: string };
        };
        setError(
          detail.error?.description ||
            detail.error?.reason ||
            "Payment failed. Try again with UPI.",
        );
        setBusy(false);
      });

      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  const ctaLabel =
    tier === "adhoc_audit"
      ? `Pay ₹${total} · ${qtyLabel}`
      : tier === "fleet_pass"
        ? `Pay ₹${total} · ${qtyLabel} · ${FLEET_PASS_DAYS}d`
        : `Pay ₹${total} · Get Pro`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-modal-title"
    >
      <div className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-zinc-700 bg-zinc-950 shadow-xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-zinc-800 bg-gradient-to-br from-safety/15 via-zinc-950 to-zinc-950 px-5 pb-4 pt-5">
          <div className="flex items-center gap-2 text-safety">
            <Sparkles className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              {copy.eyebrow}
            </span>
          </div>
          <h2
            id="pricing-modal-title"
            className="mt-1 text-xl font-semibold tracking-tight text-zinc-50"
          >
            {copy.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{copy.body}</p>

          <div className="mt-3 flex gap-1.5">
            {(
              [
                ["adhoc_audit", "Ad-hoc"],
                ["fleet_pass", "Fleet"],
                ["pro_annual", "Pro"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => setTier(id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  tier === id
                    ? "bg-safety text-zinc-950"
                    : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="mt-3 font-mono text-2xl font-semibold text-safety">
            ₹{total}
            <span className="ml-1 text-xs font-medium text-zinc-500">
              {tier === "pro_annual"
                ? `/ year · ${qtyLabel}`
                : tier === "fleet_pass"
                  ? ` / ${FLEET_PASS_DAYS}d · ${qtyLabel}`
                  : ` one-time · ${qtyLabel}`}
            </span>
          </p>
        </div>

        <ul className="space-y-3 px-5 py-4">
          {copy.benefits.map((b) => (
            <li key={b.title} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-safety/20 bg-safety/10 text-safety">
                <b.icon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium text-zinc-100">{b.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {b.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-2 border-t border-zinc-800 px-5 py-4 pb-6">
          {!success ? (
            <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
              {tier === "adhoc_audit" ? "Credits to buy" : "Vehicles to cover"}
              <input
                type="number"
                min={Math.max(vehicleQty, 1)}
                max={50}
                value={qty}
                disabled={busy}
                onChange={(e) =>
                  setQty(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
              />
            </label>
          ) : null}

          {success ? (
            <div className="flex items-center gap-2 rounded-xl border border-safety/30 bg-safety/10 px-3 py-2.5 text-sm text-safety">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              <span>Payment verified — plan activated.</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !user}
              onClick={() => void startCheckout()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-safety px-4 py-3.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
            >
              {busy ? <Spinner className="h-4 w-4" /> : null}
              {busy ? "Opening UPI checkout…" : ctaLabel}
            </button>
          )}
          <p className="text-center text-[10px] text-zinc-600">
            UPI via Razorpay · Google Pay / PhonePe / Paytm
          </p>
          {error ? (
            <p className="text-center text-xs text-emergency" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
