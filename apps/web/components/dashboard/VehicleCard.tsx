"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ExternalLink,
  FileWarning,
  MoreVertical,
  RefreshCw,
  ShieldCheck,
  Unlink,
  Wind,
} from "lucide-react";
import type { Challan, Vehicle } from "@/lib/types";
import { formatRegDisplay } from "@/lib/registration";
import { formatInr } from "@/lib/format";
import { daysUntil, pucLevel } from "@/lib/puc";
import { Spinner } from "@/components/ui/Spinner";
import { RCLinkingModal } from "@/components/RCLinkingModal";

interface VehicleCardProps {
  vehicle: Vehicle;
  challans: Challan[];
  refreshing?: boolean;
  releasing?: boolean;
  onRefresh: (regNumber: string) => void;
  onRelease: (vehicle: Vehicle) => void;
  onViewChallans: (vehicle: Vehicle) => void;
}

type ComplianceTone = "ok" | "warn" | "bad" | "unknown";

function formatLongDate(dateIso: string | null): string | null {
  if (!dateIso) return null;
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toneFromDays(days: number | null): ComplianceTone {
  if (days === null) return "unknown";
  const level = pucLevel(days);
  if (level === "green") return "ok";
  if (level === "amber") return "warn";
  return "bad";
}

function expiryStatus(days: number | null): {
  tone: ComplianceTone;
  badge: string;
  detail: string;
} {
  const tone = toneFromDays(days);
  if (days === null) {
    return { tone, badge: "N/A", detail: "Not available yet" };
  }
  if (days <= 0) {
    return { tone, badge: "EXPIRED", detail: "Renew now" };
  }
  if (days <= 15) {
    return { tone, badge: "SOON", detail: `${days}d left` };
  }
  return { tone, badge: "VALID", detail: `${days}d left` };
}

function toneClasses(tone: ComplianceTone): {
  shell: string;
  badge: string;
  label: string;
  meta: string;
  icon: string;
} {
  switch (tone) {
    case "ok":
      return {
        shell: "border-safety/35 bg-safety/5",
        badge: "border-safety/50 text-safety",
        label: "text-zinc-200",
        meta: "text-zinc-400",
        icon: "text-safety",
      };
    case "warn":
      return {
        shell: "border-amber-warn/40 bg-amber-warn/10",
        badge: "border-amber-warn/50 text-amber-warn",
        label: "text-amber-100",
        meta: "text-amber-100/70",
        icon: "text-amber-warn",
      };
    case "bad":
      return {
        shell: "border-emergency/40 bg-emergency/10",
        badge: "border-emergency/50 text-emergency",
        label: "text-red-100",
        meta: "text-red-100/70",
        icon: "text-emergency",
      };
    default:
      return {
        shell: "border-zinc-700 bg-zinc-950/60",
        badge: "border-zinc-600 text-zinc-400",
        label: "text-zinc-300",
        meta: "text-zinc-500",
        icon: "text-zinc-500",
      };
  }
}

export function VehicleCard({
  vehicle,
  challans,
  refreshing = false,
  releasing = false,
  onRefresh,
  onRelease,
  onViewChallans,
}: VehicleCardProps) {
  const unpaid = challans.filter((c) => c.status === "UNPAID");
  const pendingCount = unpaid.length;
  const totalAmount = unpaid.reduce((s, c) => s + Number(c.amount), 0);
  const pucDays = daysUntil(vehicle.puc_expiry_date);
  const insuranceDays = daysUntil(vehicle.insurance_expiry_date);
  const puc = expiryStatus(pucDays);
  const insurance = expiryStatus(insuranceDays);
  const pucTone = toneClasses(puc.tone);
  const insuranceTone = toneClasses(insurance.tone);
  const pucUntil = formatLongDate(vehicle.puc_expiry_date);
  const insuranceUntil = formatLongDate(vehicle.insurance_expiry_date);
  const title = vehicle.maker_model?.trim() || "Vehicle";
  const [menuOpen, setMenuOpen] = useState(false);
  const [rcModalOpen, setRcModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const showRcContactWarning = Boolean(vehicle.rc_contact_warning);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <article
      className={`rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-lg shadow-black/25 transition duration-300 ${
        refreshing ? "animate-pulse-soft ring-1 ring-safety/40" : ""
      }`}
    >
      {/* Top: icon + identity + menu */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-950"
          aria-hidden
        >
          <Car className="h-7 w-7 text-zinc-500" strokeWidth={1.5} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight text-zinc-50">
                {title}
              </h3>
              <p className="mt-0.5 font-mono text-sm font-medium tracking-wide text-safety">
                {formatRegDisplay(vehicle.reg_number)}
              </p>
            </div>

            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                disabled={refreshing || releasing}
                className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                aria-label="Vehicle actions"
                aria-expanded={menuOpen}
              >
                {releasing || refreshing ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <MoreVertical className="h-4 w-4" />
                )}
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 py-1 shadow-xl">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-900"
                    onClick={() => {
                      setMenuOpen(false);
                      onRefresh(vehicle.reg_number);
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-safety" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-emergency hover:bg-zinc-900"
                    onClick={() => {
                      setMenuOpen(false);
                      const ok = window.confirm(
                        `Release ${formatRegDisplay(vehicle.reg_number)} from your garage?\n\nAfter release, a new owner can claim it with the chassis last 5 from the RC.`,
                      );
                      if (ok) onRelease(vehicle);
                    }}
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    Release
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {vehicle.fuel_type ? (
            <p className="mt-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
              {vehicle.fuel_type}
            </p>
          ) : null}
        </div>
      </div>

      {showRcContactWarning ? (
        <div className="mt-3 space-y-2">
          <div
            className="flex items-start gap-2 rounded-xl border border-amber-warn/45 bg-amber-warn/10 px-3 py-2.5"
            role="status"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-warn"
              aria-hidden
            />
            <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-amber-100">
              ⚠️ RC Mobile/Aadhaar Not Seeded • ₹1,000 Fine Risk
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRcModalOpen(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-warn/40 bg-zinc-950 px-3 py-2 text-[12px] font-semibold text-amber-warn transition hover:bg-amber-warn/10"
          >
            Fix on Parivahan
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Insurance + PUC — equal visual weight */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div
          className={`rounded-xl border px-3 py-2.5 ${insuranceTone.shell}`}
          role="status"
          aria-label={`Insurance ${insurance.badge}`}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${insuranceTone.label}`}
            >
              <ShieldCheck
                className={`h-3.5 w-3.5 ${insuranceTone.icon}`}
                aria-hidden
              />
              Insurance
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${insuranceTone.badge}`}
            >
              {insurance.badge}
            </span>
          </div>
          <p className={`mt-1.5 text-[12px] font-medium ${insuranceTone.label}`}>
            {insurance.detail}
          </p>
          <p className={`mt-0.5 text-[10px] ${insuranceTone.meta}`}>
            {insuranceUntil ? `Until ${insuranceUntil}` : "Expiry unknown"}
          </p>
        </div>

        <div
          className={`rounded-xl border px-3 py-2.5 ${pucTone.shell}`}
          role="status"
          aria-label={`PUC ${puc.badge}`}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${pucTone.label}`}
            >
              <Wind className={`h-3.5 w-3.5 ${pucTone.icon}`} aria-hidden />
              PUC
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${pucTone.badge}`}
            >
              {puc.badge}
            </span>
          </div>
          <p className={`mt-1.5 text-[12px] font-medium ${pucTone.label}`}>
            {puc.detail}
          </p>
          <p className={`mt-0.5 text-[10px] ${pucTone.meta}`}>
            {pucUntil ? `Until ${pucUntil}` : "Expiry unknown"}
          </p>
        </div>
      </div>

      {/* Challan — same status language */}
      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={() => onViewChallans(vehicle)}
          className="mt-2 flex w-full items-center gap-2 rounded-xl border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5 text-left transition hover:bg-amber-warn/15"
        >
          <FileWarning
            className="h-4 w-4 shrink-0 text-amber-warn"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-warn">
              Challan
            </span>
            <span className="mt-0.5 block text-[12px] font-medium text-amber-100">
              {pendingCount} unpaid · {formatInr(totalAmount)}
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-amber-warn">
            View
          </span>
        </button>
      ) : (
        <div className="mt-2 flex w-full items-center gap-2 rounded-xl border border-safety/35 bg-safety/5 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-safety" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-safety">
              Challan
            </span>
            <span className="mt-0.5 block text-[12px] font-medium text-safety/90">
              No unpaid challans
            </span>
          </span>
          <span className="inline-flex items-center rounded-md border border-safety/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-safety">
            Clear
          </span>
        </div>
      )}

      <RCLinkingModal
        open={rcModalOpen}
        regNumber={formatRegDisplay(vehicle.reg_number)}
        onClose={() => setRcModalOpen(false)}
      />
    </article>
  );
}
