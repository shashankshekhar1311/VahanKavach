"use client";

import { useEffect } from "react";
import {
  Camera,
  ExternalLink,
  MapPin,
  X,
  IndianRupee,
} from "lucide-react";
import type { Challan, Vehicle } from "@/lib/types";
import { formatInr, formatViolationDate } from "@/lib/format";
import { formatRegDisplay } from "@/lib/registration";
import {
  buildUpiDeepLink,
  getParivahanPortalUrl,
  openPayment,
} from "@/lib/upi";
import { supabase } from "@/lib/supabase";

interface ChallanDrawerProps {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle | null;
  challans: Challan[];
  onPaidExternally?: () => void;
}

export function ChallanDrawer({
  open,
  onClose,
  vehicle,
  challans,
  onPaidExternally,
}: ChallanDrawerProps) {
  const unpaid = challans.filter((c) => c.status === "UNPAID");
  const total = unpaid.reduce((sum, c) => sum + Number(c.amount), 0);

  async function recordRedirect(challanId: string, markPaid = false) {
    if (!vehicle) return;
    const portal = getParivahanPortalUrl();
    await supabase.functions.invoke("record-challan-payment", {
      body: {
        challanId,
        vehicleId: vehicle.id,
        portalUrl: portal,
        markPaidExternally: markPaid,
      },
    });
    if (markPaid) onPaidExternally?.();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !vehicle) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close drawer"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="challan-drawer-title"
        className="relative z-10 flex max-h-[88dvh] w-full max-w-[480px] flex-col rounded-t-2xl border border-zinc-800 bg-zinc-900 shadow-2xl animate-drawer-up sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Challan settlement
            </p>
            <h2
              id="challan-drawer-title"
              className="mt-0.5 text-lg font-semibold text-zinc-50"
            >
              {vehicle.maker_model ?? "Vehicle"}
            </h2>
            <p className="font-mono text-sm text-zinc-400">
              {formatRegDisplay(vehicle.reg_number)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {unpaid.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-8 text-center text-sm text-zinc-400">
              No unpaid challans for this vehicle.
            </p>
          ) : (
            unpaid.map((challan) => (
              <article
                key={challan.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 transition hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-zinc-100">
                      {challan.violation_type ?? "Traffic violation"}
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatViolationDate(challan.violation_date)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-emergency">
                    {formatInr(Number(challan.amount))}
                  </span>
                </div>

                {challan.location && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-400">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <span>{challan.location}</span>
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {challan.evidence_url ? (
                    <a
                      href={challan.evidence_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Evidence
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-500">
                      <Camera className="h-3.5 w-3.5" />
                      No evidence
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">
                    {challan.challan_number}
                  </span>
                </div>
              </article>
            ))
          )}
        </div>

        {unpaid.length > 0 && (
          <div className="space-y-2 border-t border-zinc-800 px-4 py-4">
            <button
              type="button"
              onClick={() => {
                const first = unpaid[0];
                if (first) void recordRedirect(first.id, false);
                openPayment({
                  amount: total,
                  note: `Challan ${vehicle.reg_number} ×${unpaid.length}`,
                });
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-safety px-4 py-3.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 active:scale-[0.98]"
            >
              <IndianRupee className="h-4 w-4" />
              Pay {formatInr(total)} via UPI
            </button>
            <a
              href={getParivahanPortalUrl()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                const first = unpaid[0];
                if (first) void recordRedirect(first.id, false);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Pay on Parivahan portal
            </a>
            <button
              type="button"
              onClick={() => {
                const first = unpaid[0];
                if (first) void recordRedirect(first.id, true);
              }}
              className="w-full text-center text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
            >
              I already paid — mark as paid externally
            </button>
            <p className="break-all text-center text-[10px] text-zinc-600">
              {buildUpiDeepLink({
                amount: total,
                note: `Challan ${vehicle.reg_number}`,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
