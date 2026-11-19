"use client";

import { ExternalLink, ShieldAlert, X } from "lucide-react";

export const PARIVAHAN_MOBILE_UPDATE_URL =
  "https://vahan.parivahan.gov.in/mobileupdate/";

interface RCLinkingModalProps {
  open: boolean;
  regNumber?: string;
  onClose: () => void;
}

/**
 * Official 2-minute guide for seeding mobile / Aadhaar on the RC via Parivahan.
 *
 * Note: This modal does NOT call sync-vehicle or collect chassis for ownership.
 * Protect / claim validation + lockout UX lives in QuickAddVehicle + sync-vehicle.
 */
export function RCLinkingModal({
  open,
  regNumber,
  onClose,
}: RCLinkingModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rc-linking-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-amber-warn/40 bg-zinc-950 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-warn/15 ring-1 ring-amber-warn/40">
            <ShieldAlert className="h-5 w-5 text-amber-warn" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="rc-linking-title"
              className="text-sm font-semibold tracking-tight text-zinc-50"
            >
              Link mobile &amp; Aadhaar on your RC
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Official MoRTH / Parivahan process · ~2 minutes
              {regNumber ? (
                <>
                  {" "}
                  · <span className="font-mono text-zinc-400">{regNumber}</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-warn">
              Why it matters
            </h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
              State Transport Departments (including Bihar / Muzaffarpur
              circulars) mandate that every RC is seeded with an active mobile
              number and Aadhaar. Without it, traffic police cannot deliver
              e-challan SMS alerts — fines escalate silently to court summons,
              and you risk a{" "}
              <span className="font-semibold text-amber-100">₹1,000 penalty</span>{" "}
              for non-seeding.
            </p>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              3-step official process
            </h3>
            <ol className="mt-2 space-y-2.5">
              {[
                "Click the official Parivahan link below (MoRTH VAHAN portal).",
                "Enter Vehicle Reg No + last 5 digits of Chassis & Engine No from your RC.",
                "Authenticate with Aadhaar OTP to update your mobile number — free of charge.",
              ].map((step, i) => (
                <li key={step} className="flex gap-2.5 text-[12px] text-zinc-300">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-safety ring-1 ring-zinc-700">
                    {i + 1}
                  </span>
                  <span className="leading-snug pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <a
            href={PARIVAHAN_MOBILE_UPDATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-warn px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            Open Official VAHAN Portal
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>

          <p className="text-center text-[10px] leading-relaxed text-zinc-600">
            VahanKavach does not collect Aadhaar. Linking happens only on the
            government portal. We never store full chassis or engine numbers.
          </p>
        </div>
      </div>
    </div>
  );
}
