/**
 * Indian vehicle registration sanitization & validation.
 *
 * Accepts common user input like "ka-01 ab 1234" and normalizes to "KA01AB1234".
 * Pattern aligned with `_shared/security.ts` (strict CERT/project rule).
 */

import { INDIAN_REG_STRICT_PATTERN } from '../security.ts';

const REG_PATTERN = INDIAN_REG_STRICT_PATTERN;

export class InvalidRegistrationError extends Error {
  readonly status = 400;

  constructor(raw: string) {
    super(
      `Invalid Indian vehicle registration format: "${raw}". ` +
        `Expected pattern like KA01AB1234 (state + RTO + series + number).`,
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

  if (!REG_PATTERN.test(sanitized)) {
    throw new InvalidRegistrationError(raw);
  }

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
