"use client";

import { RefreshCw, Fuel } from "lucide-react";
import type { Challan, Vehicle } from "@/lib/types";
import { formatRegDisplay } from "@/lib/registration";
import { formatInr } from "@/lib/format";
import { daysUntil, pucLevel } from "@/lib/puc";
import { Spinner } from "@/components/ui/Spinner";

interface VehicleCardProps {
  vehicle: Vehicle;
  challans: Challan[];
  refreshing?: boolean;
  onRefresh: (regNumber: string) => void;
  onViewChallans: (vehicle: Vehicle) => void;
}

const FUEL_STYLES: Record<string, string> = {
  PETROL: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  DIESEL: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  CNG: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  ELECTRIC: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  HYBRID: "bg-teal-500/15 text-teal-300 ring-teal-500/30",
  OTHER: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
};

type Tone = "ok" | "warn" | "bad" | "muted";

function toneFromDays(days: number | null): Tone {
  if (days === null) return "muted";
  const level = pucLevel(days);
  if (level === "green") return "ok";
  if (level === "amber") return "warn";
  return "bad";
}

function toneClasses(tone: Tone): { cell: string; value: string; dot: string } {
  switch (tone) {
    case "ok":
      return {
        cell: "border-safety/20 bg-safety/5",
        value: "text-safety",
        dot: "bg-safety",
      };
    case "warn":
      return {
        cell: "border-amber-warn/25 bg-amber-warn/5",
        value: "text-amber-warn",
        dot: "bg-amber-warn",
      };
    case "bad":
      return {
        cell: "border-emergency/25 bg-emergency/5",
        value: "text-emergency",
        dot: "bg-emergency",
      };
    default:
      return {
        cell: "border-zinc-800 bg-zinc-950/40",
        value: "text-zinc-400",
        dot: "bg-zinc-600",
      };
  }
}

function shortExpiry(dateIso: string | null): string {
  if (!dateIso) return "—";
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function daysHint(days: number | null): string {
  if (days === null) return "N/A";
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "Today";
  return `${days}d`;
}

function MetricCell({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
  onClick?: () => void;
}) {
  const styles = toneClasses(tone);
  const className = `flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition ${styles.cell} ${
    onClick ? "hover:brightness-110 active:scale-[0.98]" : ""
  }`;
  const body = (
    <>
      <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
        <span className={`h-1 w-1 rounded-full ${styles.dot}`} aria-hidden />
        {label}
      </span>
      <span
        className={`w-full truncate text-[11px] font-semibold leading-tight ${styles.value}`}
        title={value}
      >
        {value}
      </span>
      <span className="truncate text-[9px] text-zinc-500">{hint}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return (
    <div className={className} role="listitem">
      {body}
    </div>
  );
}

export function VehicleCard({
  vehicle,
  challans,
  refreshing = false,
  onRefresh,
  onViewChallans,
}: VehicleCardProps) {
  const unpaid = challans.filter((c) => c.status === "UNPAID");
  const pendingCount = unpaid.length;
  const totalAmount = unpaid.reduce((s, c) => s + Number(c.amount), 0);
  const fuelClass =
    FUEL_STYLES[vehicle.fuel_type ?? "OTHER"] ?? FUEL_STYLES.OTHER;

  const insuranceDays = daysUntil(vehicle.insurance_expiry_date);
  const pucDays = daysUntil(vehicle.puc_expiry_date);
  const fitnessDays = daysUntil(vehicle.fitness_expiry_date);
  const challanTone: Tone =
    pendingCount > 0 ? "bad" : challans.length === 0 ? "muted" : "ok";

  return (
    <article
      className={`rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 shadow-lg shadow-black/20 transition duration-300 ${
        refreshing ? "animate-pulse-soft ring-1 ring-safety/40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-50">
            {vehicle.maker_model ?? "Unknown vehicle"}
          </h3>
          <p className="mt-0.5 font-mono text-xs tracking-wide text-zinc-400">
            {formatRegDisplay(vehicle.reg_number)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {vehicle.fuel_type && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${fuelClass}`}
            >
              <Fuel className="h-3 w-3" />
              {vehicle.fuel_type}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRefresh(vehicle.reg_number)}
            disabled={refreshing}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-safety disabled:opacity-50"
            aria-label="Refresh compliance"
          >
            {refreshing ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div
        className="mt-3 grid grid-cols-4 gap-1.5"
        role="list"
        aria-label="Compliance snapshot"
      >
        <MetricCell
          label="Ins"
          value={shortExpiry(vehicle.insurance_expiry_date)}
          hint={daysHint(insuranceDays)}
          tone={toneFromDays(insuranceDays)}
        />
        <MetricCell
          label="PUC"
          value={shortExpiry(vehicle.puc_expiry_date)}
          hint={daysHint(pucDays)}
          tone={toneFromDays(pucDays)}
        />
        <MetricCell
          label="Challan"
          value={pendingCount === 0 ? "Clear" : String(pendingCount)}
          hint={
            pendingCount === 0
              ? "None due"
              : formatInr(totalAmount).replace(/\s/g, "")
          }
          tone={challanTone}
          onClick={
            pendingCount > 0 ? () => onViewChallans(vehicle) : undefined
          }
        />
        <MetricCell
          label="Fit"
          value={shortExpiry(vehicle.fitness_expiry_date)}
          hint={daysHint(fitnessDays)}
          tone={toneFromDays(fitnessDays)}
        />
      </div>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={() => onViewChallans(vehicle)}
          className="mt-2 w-full rounded-lg border border-emergency/30 bg-emergency/10 px-2 py-1.5 text-[11px] font-semibold text-emergency transition hover:bg-emergency/15"
        >
          View & pay {pendingCount} challan{pendingCount === 1 ? "" : "s"} ·{" "}
          {formatInr(totalAmount)}
        </button>
      )}
    </article>
  );
}
