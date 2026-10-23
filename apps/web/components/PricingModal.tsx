"use client";

import { useEffect, useState } from "react";

import {
  BellRing,
  Camera,
  Check,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Spinner } from "@/components/ui/Spinner";
import {
  ANNUAL_PREPAID_RUPEES_PER_VEHICLE,
  annualTotalRupees,
  pricingHeadline,
  pricingSubcopy,
} from "@/lib/pricing";
import {
  loadRazorpayCheckout,
  type RazorpaySuccessResponse,
} from "@/lib/razorpay";
import { supabase } from "@/lib/supabase";

const BENEFITS = [
  {
    icon: Camera,
    title: "Real-time ANPR challan alerts",
    body: "Automated e-challan monitoring when cameras catch your plate — Telegram / in-app.",
  },
  {
    icon: BellRing,
    title: "Daily automated PUC monitoring",
    body: "Expiry sweeps before you get flagged at a checkpoint or toll.",
  },
  {
    icon: Shield,
    title: "Per-vehicle annual cover",
    body: "₹1/day per vehicle. Pay ₹329/year prepaid and save about one month vs ₹365.",
  },
] as const;

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  /** Suggested vehicle quantity (garage size). */
  vehicleQty?: number;
  onActivated?: () => void;
}

export function PricingModal({
  open,
  onClose,
  vehicleQty = 1,
  onActivated,
}: PricingModalProps) {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [qty, setQty] = useState(Math.max(1, vehicleQty));

  useEffect(() => {
    if (open) setQty(Math.max(1, vehicleQty));
  }, [open, vehicleQty]);

  if (!open) return null;

  const total = annualTotalRupees(qty);

  async function startCheckout() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "create-order",
        { body: { vehicleQty: qty } },
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
        onActivated?.();
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
        description:
          payload.data.description ??
          `Kavach Pro — ${qty} vehicle(s) × ₹${ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/year`,
        order_id: payload.data.orderId,
        prefill: {
          contact: profile?.phone_number ?? undefined,
          email: user.email ?? undefined,
          method: isMobile ? "upi" : undefined,
        },
        theme: { color: "#10b981" },
        config: {
          display: {
            blocks: {
              utib: {
                name: "Pay using UPI",
                instruments: [{ method: "upi" }],
              },
            },
            sequence: ["block.utib"],
            preferences: {
              show_default_blocks: true,
            },
          },
        },
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
            onActivated?.();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Payment captured but verification failed. Contact support with your payment ID.",
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
            "Payment failed. Try again with UPI or another method.",
        );
        setBusy(false);
      });

      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-modal-title"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-zinc-800 bg-gradient-to-br from-safety/15 via-zinc-950 to-zinc-950 px-5 pb-4 pt-5">
          <div className="flex items-center gap-2 text-safety">
            <Sparkles className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              Kavach Pro
            </span>
          </div>
          <h2
            id="pricing-modal-title"
            className="mt-1 text-xl font-semibold tracking-tight text-zinc-50"
          >
            Annual prepaid
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            ₹1/day per vehicle. Pay yearly and save about one month.
          </p>
          <p className="mt-3 font-mono text-2xl font-semibold text-safety">
            {pricingHeadline(qty)}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">{pricingSubcopy(qty)}</p>
        </div>

        <ul className="space-y-3 px-5 py-4">
          {BENEFITS.map((b) => (
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

        <div className="space-y-2 border-t border-zinc-800 px-5 py-4">
          {!profile?.is_pro && !success ? (
            <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
              Vehicles to cover
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

          {profile?.is_pro || success ? (
            <div className="flex items-center gap-2 rounded-xl border border-safety/30 bg-safety/10 px-3 py-2.5 text-sm text-safety">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                Pro is active
                {success ? " — payment verified." : " on this account."}
              </span>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || !user}
              onClick={() => void startCheckout()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-safety px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
            >
              {busy ? <Spinner className="h-4 w-4" /> : null}
              {busy
                ? "Opening UPI checkout…"
                : `Pay ₹${total} · Get Pro`}
            </button>
          )}
          <p className="text-center text-[10px] text-zinc-600">
            Mobile opens Google Pay, PhonePe, or Paytm via UPI intent. Secured by
            Razorpay.
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
