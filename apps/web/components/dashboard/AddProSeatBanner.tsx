"use client";

import { useState } from "react";
import { CreditCard, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Spinner } from "@/components/ui/Spinner";
import { ANNUAL_PREPAID_RUPEES_PER_VEHICLE } from "@/lib/pricing";
import { loadRazorpayCheckout } from "@/lib/razorpay";
import { supabase } from "@/lib/supabase";

interface AddProSeatBannerProps {
  /** Seats already on the Pro plan. */
  coveredSeats: number;
  /** Total seats required after this add (usually garage + 1). */
  seatsNeeded: number;
  onDismiss: () => void;
  /** Called after seats are expanded (mock or paid). */
  onActivated: () => void | Promise<void>;
  onSeeOtherPlans?: () => void;
}

/**
 * Phase 1: expand existing Pro by charging only extra seats (₹399 × N),
 * keeping the current annual window.
 */
export function AddProSeatBanner({
  coveredSeats,
  seatsNeeded,
  onDismiss,
  onActivated,
  onSeeOtherPlans,
}: AddProSeatBannerProps) {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const needed = Math.max(seatsNeeded, coveredSeats + 1, 1);
  const extra = Math.max(1, needed - Math.max(coveredSeats, 0));
  const deltaTotal = extra * ANNUAL_PREPAID_RUPEES_PER_VEHICLE;

  async function handleAddSeats() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-billing-checkout",
        {
          body: {
            vehicleQty: needed,
            mode: "expand_seats",
          },
        },
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
          message?: string;
          mode?: string;
          extraSeats?: number;
          vehicleQty?: number;
          amountRupees?: number;
        };
      } | null;

      if (error) throw new Error(payload?.error || error.message);
      if (!payload?.success || !payload.data) {
        throw new Error(payload?.error ?? "Checkout failed");
      }

      if (payload.data.mock) {
        setMessage(
          payload.data.message ??
            `Added ${extra} seat(s) — continuing Protect…`,
        );
        await onActivated();
        return;
      }

      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error("Razorpay unavailable");

      const rzp = new window.Razorpay({
        key: payload.data.keyId,
        amount: payload.data.amountPaise,
        currency: "INR",
        name: "VahanKavach",
        description:
          payload.data.description ??
          `Add ${extra} Pro seat(s)`,
        order_id: payload.data.orderId,
        prefill: {
          email: user.email ?? undefined,
          contact: profile?.phone_number ?? undefined,
        },
        handler: () => {
          setMessage("Payment received — updating seats…");
          window.setTimeout(() => {
            void onActivated();
          }, 2500);
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });
      rzp.open();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-3"
      role="status"
      aria-label="Add Pro seats"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">
            Add {extra} Pro seat{extra > 1 ? "s" : ""} · ₹{deltaTotal}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
            Plan covers {Math.max(coveredSeats, 0)} · expand to {needed} at ₹
            {ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/extra seat. Same renewal date —
            you only pay for the new seat{extra > 1 ? "s" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !user}
          onClick={() => void handleAddSeats()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-safety px-3 py-1.5 text-[11px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <CreditCard className="h-3.5 w-3.5" />
          )}
          {busy ? "Opening checkout…" : `Pay ₹${deltaTotal} · add seat`}
        </button>
        {onSeeOtherPlans ? (
          <button
            type="button"
            disabled={busy}
            onClick={onSeeOtherPlans}
            className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
          >
            Other plans
          </button>
        ) : null}
      </div>

      {message ? (
        <p className="mt-2 text-[11px] text-zinc-400">{message}</p>
      ) : null}
    </section>
  );
}
