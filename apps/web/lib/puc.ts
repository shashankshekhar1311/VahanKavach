import type { PucLevel } from "./types";

/** Calendar-day difference from today (UTC date) to an ISO date string. */
export function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;

  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - todayUtc) / msPerDay);
}

export function pucLevel(daysRemaining: number | null): PucLevel {
  // Green >15 · Amber 1–15 · Red expired / due today
  if (daysRemaining === null || daysRemaining <= 0) return "red";
  if (daysRemaining <= 15) return "amber";
  return "green";
}

export function pucLevelColor(level: PucLevel): string {
  switch (level) {
    case "green":
      return "#10B981";
    case "amber":
      return "#F59E0B";
    case "red":
      return "#EF4444";
  }
}

export function formatExpiryLabel(dateIso: string | null): string {
  if (!dateIso) return "Not available";
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isExpired(dateIso: string | null | undefined): boolean {
  const days = daysUntil(dateIso);
  return days !== null && days <= 0;
}
