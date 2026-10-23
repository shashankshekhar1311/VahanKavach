/**
 * Pricing:
 *   List: ₹1 / vehicle / day → ₹365 / vehicle / year
 *   Annual prepaid: ₹329 / vehicle / year (save ~1 month vs ₹365)
 */

export const LIST_RUPEES_PER_VEHICLE_YEAR = 365;
export const ANNUAL_PREPAID_RUPEES_PER_VEHICLE = 329;
export const ANNUAL_PREPAID_PAISE_PER_VEHICLE = 32_900;
export const BILLING_PERIOD_DAYS = 365;

/** Paise charged per vehicle for one prepaid annual period (default 32900). */
export function billingPaisePerVehicleYear(): number {
  const raw =
    Deno.env.get('BILLING_PAISE_PER_VEHICLE_YEAR')?.trim() ||
    // Legacy monthly env: if still set to 3000, ignore and use annual default.
    Deno.env.get('BILLING_PAISE_PER_VEHICLE_MONTH')?.trim();
  const n = raw ? Number(raw) : ANNUAL_PREPAID_PAISE_PER_VEHICLE;
  // Treat old monthly default (3000) as unset so launches use ₹329/year.
  if (n === 3000) return ANNUAL_PREPAID_PAISE_PER_VEHICLE;
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
