/**
 * Kavach Pro — annual prepaid per vehicle.
 * List ₹365/year (₹1/day) · Prepaid ₹329/year (save ~1 month).
 */

import {
  ANNUAL_PREPAID_PAISE_PER_VEHICLE,
  ANNUAL_PREPAID_RUPEES_PER_VEHICLE,
  LIST_RUPEES_PER_VEHICLE_YEAR,
  billingPaisePerVehicleYear,
  rupeesPerVehicleYear,
} from './config.ts';

export const KAVACH_PRO_LIST_RUPEES = LIST_RUPEES_PER_VEHICLE_YEAR;
export const KAVACH_PRO_AMOUNT_RUPEES = ANNUAL_PREPAID_RUPEES_PER_VEHICLE;
export const KAVACH_PRO_AMOUNT_PAISE = ANNUAL_PREPAID_PAISE_PER_VEHICLE;
export const KAVACH_PRO_CURRENCY = 'INR';
export const KAVACH_PRO_PRODUCT = 'kavach_pro_annual';

export function kavachProDescription(vehicleQty: number): string {
  const qty = Math.max(1, vehicleQty);
  const total = qty * rupeesPerVehicleYear();
  return `Kavach Pro — ${qty} vehicle(s) × ₹${rupeesPerVehicleYear()}/year (₹1/day · save 1 month vs ₹${KAVACH_PRO_LIST_RUPEES}) · ₹${total} total`;
}

/** @deprecated Use kavachProDescription(qty) */
export const KAVACH_PRO_DESCRIPTION = kavachProDescription(1);

export function proAmountPaise(vehicleQty: number): number {
  return Math.max(1, vehicleQty) * billingPaisePerVehicleYear();
}

export function proAmountRupees(vehicleQty: number): number {
  return proAmountPaise(vehicleQty) / 100;
}

export function proMockEnabled(): boolean {
  const v = (Deno.env.get('BILLING_MOCK') ?? '').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
