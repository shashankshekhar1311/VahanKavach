/**
 * In-memory vehicle scrubber — data minimization before persist / client return.
 * Never log raw vendor JSON. Never keep addresses, phones, or full chassis.
 */

import type { StandardVehicleCompliance } from './types.ts';
import { linkedContactCompliance } from './providers/contact-compliance.ts';

/** Strict 30-day upstream cache window (security / API-balance protection). */
export const VEHICLE_CACHE_TTL_DAYS = 30;

export function vehicleCacheUntilIso(from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + VEHICLE_CACHE_TTL_DAYS);
  return d.toISOString();
}

export function isCachedUntilFresh(
  cachedUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!cachedUntil) return false;
  const ts = new Date(cachedUntil).getTime();
  if (Number.isNaN(ts)) return false;
  return ts > now.getTime();
}

/** Last 5 alphanumeric chars only (uppercase). */
export function normalizeChassisLast5(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 5) return null;
  return cleaned.slice(-5);
}

/**
 * Extract only compliance-safe fields. Discards addresses, phones,
 * insurance company/policy identifiers, and any unexpected extras.
 */
export function scrubVehicleCompliance(
  raw: StandardVehicleCompliance,
): StandardVehicleCompliance {
  const chassisLast5 = normalizeChassisLast5(raw.chassisLast5) ?? undefined;
  const engineLast5 = normalizeChassisLast5(raw.engineLast5) ?? undefined;
  const mobileLinked = raw.contactCompliance?.mobileLinked !== false;
  const aadhaarLinked = raw.contactCompliance?.aadhaarLinked !== false;

  return {
    regNumber: raw.regNumber,
    chassisLast5,
    engineLast5,
    makerModel: (raw.makerModel || '').slice(0, 200),
    fuelType: raw.fuelType || 'OTHER',
    registrationDate: '',
    puc: {
      isValid: Boolean(raw.puc?.isValid),
      validUpto: raw.puc?.validUpto ?? null,
      daysRemaining: Number(raw.puc?.daysRemaining) || 0,
    },
    insurance: {
      isValid: Boolean(raw.insurance?.isValid),
      validUpto: raw.insurance?.validUpto ?? null,
      companyName: null,
    },
    fitness: {
      validUpto: raw.fitness?.validUpto ?? null,
    },
    contactCompliance: linkedContactCompliance({
      mobileLinked,
      aadhaarLinked,
      // Never forward masked citizen mobiles to clients / DB.
      maskedMobile: undefined,
      warningNotice:
        !mobileLinked || !aadhaarLinked
          ? 'Mobile and Aadhaar not seeded in VAHAN database. Rs 1,000 fine risk.'
          : undefined,
    }),
    fastagStatus: raw.fastagStatus ?? null,
    fastagBank: null,
  };
}

/**
 * Zero-knowledge client projection: never return chassis/engine fragments.
 * Ownership proof stays server-side only (compare last-5, store last-5).
 */
export function toClientVehicle(
  raw: StandardVehicleCompliance,
): StandardVehicleCompliance {
  const scrubbed = scrubVehicleCompliance(raw);
  return {
    ...scrubbed,
    chassisLast5: undefined,
    engineLast5: undefined,
  };
}
