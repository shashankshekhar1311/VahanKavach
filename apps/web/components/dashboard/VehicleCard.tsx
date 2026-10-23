"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  MoreVertical,
  RefreshCw,
  Unlink,
} from "lucide-react";
import type { Challan, Vehicle } from "@/lib/types";
import { formatRegDisplay } from "@/lib/registration";
import { formatInr } from "@/lib/format";
import { daysUntil, pucLevel } from "@/lib/puc";
import { Spinner } from "@/components/ui/Spinner";

interface VehicleCardProps {
  vehicle: Vehicle;
  challans: Challan[];
  refreshing?: boolean;
  releasing?: boolean;
  onRefresh: (regNumber: string) => void;
  onRelease: (vehicle: Vehicle) => void;
  onViewChallans: (vehicle: Vehicle) => void;
}

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

/** Fill 0–1 for PUC validity bar (demo-style). */
function pucBarFill(days: number | null): number {
  if (days === null) return 0;
  if (days <= 0) return 0.06;
  return Math.min(1, Math.max(0.12, days / 180));
}

function pucBadge(days: number | null): {
  label: string;
  className: string;
} {
  const level = pucLevel(days);
  if (days === null) {
    return {
      label: "PUC N/A",
      className: "border-zinc-600 text-zinc-400",
    };
  }
  if (level === "green") {
    return {
      label: "PUC VALID",
      className: "border-safety/50 text-safety",
    };
  }
  if (level === "amber") {
    return {
      label: "PUC SOON",
      className: "border-amber-warn/50 text-amber-warn",
    };
  }
  return {
    label: "PUC EXPIRED",
    className: "border-emergency/50 text-emergency",
  };
}

function barColor(days: number | null): string {
  const level = pucLevel(days);
  if (level === "green") return "bg-safety";
  if (level === "amber") return "bg-amber-warn";
  if (days === null) return "bg-zinc-600";
  return "bg-emergency";
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
  const badge = pucBadge(pucDays);
  const fill = pucBarFill(pucDays);
  const pucUntil = formatLongDate(vehicle.puc_expiry_date);
  const title = vehicle.maker_model?.trim() || "Vehicle";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {vehicle.fuel_type ? (
              <span className="text-[11px] text-zinc-500">
                {vehicle.fuel_type}
              </span>
            ) : null}
            {insuranceDays !== null ? (
              <span className="text-[11px] text-zinc-500">
                Ins ·{" "}
                {insuranceDays < 0
                  ? "expired"
                  : `${insuranceDays}d left`}
              </span>
            ) : null}
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
        </div>
      </div>

      {/* PUC validity bar */}
      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor(pucDays)}`}
            style={{ width: `${Math.round(fill * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          {pucUntil
            ? `PUC valid until ${pucUntil}`
            : "PUC expiry not available yet"}
          {pucDays !== null && pucDays > 0 ? (
            <span className="text-zinc-600"> · {pucDays}d left</span>
          ) : null}
          {pucDays !== null && pucDays <= 0 ? (
            <span className="text-emergency"> · renew now</span>
          ) : null}
        </p>
      </div>

      {/* Challan status footer */}
      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={() => onViewChallans(vehicle)}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-amber-warn/35 bg-amber-warn/10 px-3 py-2.5 text-left transition hover:bg-amber-warn/15"
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-amber-warn"
            aria-hidden
          />
          <span className="min-w-0 flex-1 text-[12px] font-medium text-amber-100">
            {pendingCount} unpaid challan{pendingCount === 1 ? "" : "s"} ·{" "}
            {formatInr(totalAmount)}
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-amber-warn">
            View
          </span>
        </button>
      ) : (
        <div className="mt-3 flex w-full items-center gap-2 rounded-xl border border-safety/25 bg-safety/5 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-safety" aria-hidden />
          <span className="text-[12px] font-medium text-safety/90">
            No unpaid challans
          </span>
        </div>
      )}
    </article>
  );
}
