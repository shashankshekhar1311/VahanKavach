"use client";

import { daysUntil, formatExpiryLabel, pucLevel, pucLevelColor } from "@/lib/puc";

interface PucGaugeProps {
  pucExpiryDate: string | null;
}

export function PucGauge({ pucExpiryDate }: PucGaugeProps) {
  const days = daysUntil(pucExpiryDate);
  const level = pucLevel(days);
  const color = pucLevelColor(level);
  const expired = days !== null && days <= 0;
  const displayDays = days === null ? "—" : days === 0 ? "0" : Math.abs(days);
  const label =
    days === null
      ? "PUC unknown"
      : days < 0
        ? "Days overdue"
        : days === 0
          ? "Expires today"
          : "Days remaining";

  // Arc progress: clamp 0–60 days onto a semi-circle
  const progress =
    days === null ? 0 : Math.max(0, Math.min(1, (days ?? 0) / 60));
  const circumference = 2 * Math.PI * 42;
  const dash = circumference * 0.75 * progress;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-[135deg]">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeDasharray={`${circumference * 0.75} ${circumference}`}
            className="text-zinc-800"
            strokeLinecap="round"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
          <span
            className="text-3xl font-bold tabular-nums leading-none"
            style={{ color }}
          >
            {displayDays}
          </span>
          <span className="mt-1 max-w-[4.5rem] text-center text-[10px] uppercase tracking-wide text-zinc-500">
            {label}
          </span>
        </div>
      </div>

      <p className="text-xs text-zinc-400">
        Expires {formatExpiryLabel(pucExpiryDate)}
      </p>

      {expired && (
        <span className="inline-flex items-center rounded-md bg-emergency/15 px-2 py-1 text-xs font-medium text-emergency ring-1 ring-emergency/30">
          ₹10,000 fine risk
        </span>
      )}
    </div>
  );
}
