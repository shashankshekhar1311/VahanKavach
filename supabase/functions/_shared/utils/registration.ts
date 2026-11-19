/**
 * Indian vehicle registration sanitization & validation.
 *
 * Accepts common user input like "ka-01 ab 1234" and normalizes to "KA01AB1234".
 * Also accepts Bharat Series plates like "22 BH 1234 AA" → "22BH1234AA".
 */

import {
  INDIAN_BHARAT_SERIES_PATTERN,
  INDIAN_REG_STRICT_PATTERN,
  isStrictIndianVehicleNumber,
} from '../security.ts';

export class InvalidRegistrationError extends Error {
  readonly status = 400;

  constructor(raw: string) {
    super(
      `Invalid Indian vehicle registration format: "${raw}". ` +
        `Expected KA01AB1234 (RTO) or 22BH1234AA (Bharat Series).`,
    );
    this.name = 'InvalidRegistrationError';
  }
}

/**
 * Strip whitespace / hyphens / other separators, uppercase, and validate.
 * @throws {InvalidRegistrationError} when the result is not a valid Indian plate.
 */
export function sanitizeRegNumber(raw: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new InvalidRegistrationError(String(raw ?? ''));
  }

  const sanitized = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (!isStrictIndianVehicleNumber(sanitized)) {
    throw new InvalidRegistrationError(raw);
  }

  // Touch patterns so tree-shaking keeps them referenced with security.ts.
  void INDIAN_REG_STRICT_PATTERN;
  void INDIAN_BHARAT_SERIES_PATTERN;

  return sanitized;
}

export function isValidRegNumber(raw: string): boolean {
  try {
    sanitizeRegNumber(raw);
    return true;
  } catch {
    return false;
  }
}
