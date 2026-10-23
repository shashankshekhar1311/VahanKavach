/** Client-facing Kavach Pro pricing (keep in sync with edge `billing/config.ts`). */

export const LIST_RUPEES_PER_VEHICLE_YEAR = 365;
export const ANNUAL_PREPAID_RUPEES_PER_VEHICLE = 329;
export const DAILY_RUPEES_PER_VEHICLE = 1;

export function annualTotalRupees(vehicleQty: number): number {
  return Math.max(1, vehicleQty) * ANNUAL_PREPAID_RUPEES_PER_VEHICLE;
}

export function listAnnualTotalRupees(vehicleQty: number): number {
  return Math.max(1, vehicleQty) * LIST_RUPEES_PER_VEHICLE_YEAR;
}

export function pricingHeadline(vehicleQty = 1): string {
  const qty = Math.max(1, vehicleQty);
  if (qty === 1) {
    return `₹${ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/year per vehicle`;
  }
  return `₹${annualTotalRupees(qty)}/year · ${qty} vehicles`;
}

export function pricingSubcopy(vehicleQty = 1): string {
  const qty = Math.max(1, vehicleQty);
  return `₹${DAILY_RUPEES_PER_VEHICLE}/day · save 1 month vs ₹${listAnnualTotalRupees(qty)}`;
}
