/** Client-facing plan pricing (keep in sync with edge `billing/plans.ts`). */

export type PlanTier = 'free' | 'adhoc_audit' | 'pro_annual' | 'fleet_pass';

/** À-la-carte anchor ≈ ~37 challan checks/year × ₹19. */
export const LIST_RUPEES_PER_VEHICLE_YEAR = 699;
export const ANNUAL_PREPAID_RUPEES_PER_VEHICLE = 399;
export const ADHOC_AUDIT_RUPEES = 19;
export const FLEET_PASS_RUPEES = 99;
export const FLEET_PASS_DAYS = 7;
/** Pro scheduled challan poll interval (days). */
export const CHALLAN_POLL_DAYS = 10;
export const DAILY_RUPEES_PER_VEHICLE = 1;

export const PLAN_PRICES_RUPEES: Record<PlanTier, number> = {
  free: 0,
  adhoc_audit: ADHOC_AUDIT_RUPEES,
  pro_annual: ANNUAL_PREPAID_RUPEES_PER_VEHICLE,
  fleet_pass: FLEET_PASS_RUPEES,
};

export function annualTotalRupees(vehicleQty: number): number {
  return Math.max(1, vehicleQty) * ANNUAL_PREPAID_RUPEES_PER_VEHICLE;
}

export function listAnnualTotalRupees(vehicleQty: number): number {
  return Math.max(1, vehicleQty) * LIST_RUPEES_PER_VEHICLE_YEAR;
}

/** Unit price × qty for any paid tier (free → 0). */
export function planTotalRupees(tier: PlanTier, vehicleQty = 1): number {
  if (tier === 'free') return 0;
  return Math.max(1, vehicleQty) * PLAN_PRICES_RUPEES[tier];
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
  return (
    `Ad-hoc ₹${ADHOC_AUDIT_RUPEES}/credit · Fleet ₹${FLEET_PASS_RUPEES}/vehicle/${FLEET_PASS_DAYS}d · ` +
    `Pro ₹${ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/vehicle/yr (challan every ${CHALLAN_POLL_DAYS}d)` +
    (qty > 1 ? ` · ${qty} vehicles` : '')
  );
}
