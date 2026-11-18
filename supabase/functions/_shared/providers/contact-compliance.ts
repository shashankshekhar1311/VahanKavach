/**
 * Helpers for RC mobile / Aadhaar seeding detection across providers.
 */

import type { ContactCompliance } from '../types.ts';

export const PARIVAHAN_MOBILE_UPDATE_URL =
  'https://vahan.parivahan.gov.in/mobileupdate/';

export const RC_CONTACT_WARNING_NOTICE =
  'Mobile and Aadhaar not seeded in VAHAN database. Rs 1,000 fine risk.';

const DUMMY_MOBILES = new Set([
  '0000000000',
  '9999999999',
  '1111111111',
  '1234567890',
]);

/** Linked by default (safe for fixtures that omit contactCompliance). */
export function linkedContactCompliance(
  overrides?: Partial<ContactCompliance>,
): ContactCompliance {
  return {
    mobileLinked: true,
    aadhaarLinked: true,
    ...overrides,
  };
}

export function unlinkedContactCompliance(
  warningNotice: string = RC_CONTACT_WARNING_NOTICE,
): ContactCompliance {
  return {
    mobileLinked: false,
    aadhaarLinked: false,
    warningNotice,
  };
}

export function isDummyMobile(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return true;
  if (digits.length < 10) return true;
  const last10 = digits.slice(-10);
  return DUMMY_MOBILES.has(last10);
}

/**
 * Derive contactCompliance from a raw RC payload (Setu / Surepass / VAHAN).
 * Missing, null, or dummy mobiles → unlinked. Explicit aadhaar flags respected.
 */
export function contactComplianceFromRcData(
  data: Record<string, unknown>,
): ContactCompliance {
  const mobileRaw =
    data.mobile_number ??
    data.mobileNumber ??
    data.masked_mobile ??
    data.maskedMobile ??
    data.owner_mobile ??
    data.rc_mobile_no ??
    null;

  const mobileStr =
    mobileRaw === null || mobileRaw === undefined
      ? null
      : String(mobileRaw).trim();

  const mobileLinked = !isDummyMobile(mobileStr);

  const aadhaarFlag =
    data.aadhaar_flag ??
    data.aadhaarFlag ??
    data.aadhaar_linked ??
    data.aadhaarLinked ??
    data.is_aadhaar_linked ??
    null;

  let aadhaarLinked: boolean;
  if (typeof aadhaarFlag === 'boolean') {
    aadhaarLinked = aadhaarFlag;
  } else if (aadhaarFlag == null || aadhaarFlag === '') {
    aadhaarLinked = mobileLinked;
  } else {
    const s = String(aadhaarFlag).trim().toLowerCase();
    if (['y', 'yes', 'true', '1', 'linked', 'seeded'].includes(s)) {
      aadhaarLinked = true;
    } else if (['n', 'no', 'false', '0', 'unlinked', 'not_linked'].includes(s)) {
      aadhaarLinked = false;
    } else {
      aadhaarLinked = mobileLinked;
    }
  }

  const maskedMobile = mobileStr ? maskMobile(mobileStr) : undefined;

  const warningNotice =
    !mobileLinked || !aadhaarLinked ? RC_CONTACT_WARNING_NOTICE : undefined;

  return {
    mobileLinked,
    aadhaarLinked,
    maskedMobile,
    warningNotice,
  };
}

function maskMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length < 10) return '******';
  return `${last10.slice(0, 2)}******${last10.slice(-2)}`;
}
