/**
 * Pricing (multi-tier):
 *   free — manual dates only
 *   adhoc_audit — ₹19 / live sync credit
 *   fleet_pass — ₹99 / 7 days
 *   pro_annual — ₹399 / vehicle / year (challan poll every 10 days)
 */

export const LIST_RUPEES_PER_VEHICLE_YEAR = 699;
export const ANNUAL_PREPAID_RUPEES_PER_VEHICLE = 399;
export const ANNUAL_PREPAID_PAISE_PER_VEHICLE = 39_900;
export const ADHOC_AUDIT_PAISE = 1_900;
export const FLEET_PASS_PAISE = 9_900;
export const BILLING_PERIOD_DAYS = 365;
/** Pro scheduled challan poll interval (days). */
export const CHALLAN_POLL_DAYS = 10;

/** Paise charged per vehicle for one prepaid annual period (default 39900). */
export function billingPaisePerVehicleYear(): number {
  const raw =
    Deno.env.get('BILLING_PAISE_PER_VEHICLE_YEAR')?.trim() ||
    // Legacy monthly env: if still set to 3000, ignore and use annual default.
    Deno.env.get('BILLING_PAISE_PER_VEHICLE_MONTH')?.trim();
  const n = raw ? Number(raw) : ANNUAL_PREPAID_PAISE_PER_VEHICLE;
  // Treat old monthly / prior annual defaults as unset.
  if (n === 3000 || n === 19_900 || n === 32_900) {
    return ANNUAL_PREPAID_PAISE_PER_VEHICLE;
  }
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : ANNUAL_PREPAID_PAISE_PER_VEHICLE;
}

/** @deprecated Use billingPaisePerVehicleYear — kept for older call sites. */
export function billingPaisePerVehicleMonth(): number {
  return billingPaisePerVehicleYear();
}

export function trialDays(): number {
  const raw = Deno.env.get('BILLING_TRIAL_DAYS')?.trim();
  const n = raw ? Number(raw) : 14;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

/** Cache TTL for entitled cheap-tier refreshes (default 7 days). */
export function entitledCacheTtlMs(): number {
  const raw = Deno.env.get('BILLING_CACHE_TTL_HOURS')?.trim();
  const hours = raw ? Number(raw) : 168;
  const h = Number.isFinite(hours) && hours > 0 ? hours : 168;
  return h * 60 * 60 * 1000;
}

export function billingMockEnabled(): boolean {
  const envName = (Deno.env.get('ENVIRONMENT') ?? '').toLowerCase();
  if (envName === 'production' || envName === 'prod') return false;
  return (Deno.env.get('BILLING_MOCK') ?? '').toLowerCase() === 'true';
}

export function rupeesPerVehicleYear(): number {
  return billingPaisePerVehicleYear() / 100;
}

export function billingPeriodDays(): number {
  const raw = Deno.env.get('BILLING_PERIOD_DAYS')?.trim();
  const n = raw ? Number(raw) : BILLING_PERIOD_DAYS;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : BILLING_PERIOD_DAYS;
}

export function listRupeesPerVehicleYear(): number {
  return LIST_RUPEES_PER_VEHICLE_YEAR;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days left until periodEnd (min 1 if still in the future). */
export function daysRemainingUntil(
  periodEnd: string | Date,
  now = new Date(),
): number {
  const end = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return 0;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

/**
 * Mid-cycle Pro expand: ₹399 × seats × (daysLeft / periodDays), rounded to ₹.
 * Returns paise for Razorpay (min 100 = ₹1).
 */
export function prorateExpandSeatPaise(
  extraSeats: number,
  periodEnd: string | Date,
  opts?: { now?: Date; periodDays?: number },
): {
  amountPaise: number;
  amountRupees: number;
  daysRemaining: number;
  periodDays: number;
  fullYearPaise: number;
} {
  const extra = Math.max(1, Math.floor(extraSeats));
  const periodDays = Math.max(1, opts?.periodDays ?? billingPeriodDays());
  const unitPaise = billingPaisePerVehicleYear();
  const fullYearPaise = extra * unitPaise;
  const daysRemaining = daysRemainingUntil(periodEnd, opts?.now ?? new Date());
  if (daysRemaining <= 0) {
    return {
      amountPaise: fullYearPaise,
      amountRupees: fullYearPaise / 100,
      daysRemaining: 0,
      periodDays,
      fullYearPaise,
    };
  }
  const rawRupees = (fullYearPaise / 100) * (daysRemaining / periodDays);
  const amountRupees = Math.max(1, Math.round(rawRupees));
  return {
    amountPaise: amountRupees * 100,
    amountRupees,
    daysRemaining,
    periodDays,
    fullYearPaise,
  };
}
