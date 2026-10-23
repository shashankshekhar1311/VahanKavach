/**
 * Normalize inbound WhatsApp / Indian mobile numbers to E.164 (+91…).
 * Meta Cloud API typically sends `from` / `wa_id` as digits only (e.g. 919876543210).
 */

export function normalizeIndianPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Phone number is empty');
  }

  const digits = trimmed.replace(/\D/g, '');

  // Already country-coded India mobile: 91 + 10 digits
  if (digits.startsWith('91') && digits.length === 12) {
    return `+${digits}`;
  }

  // Bare 10-digit Indian mobile
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }

  // Other E.164-ish: keep + and digits
  if (trimmed.startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  throw new Error(`Unrecognized phone number format: ${raw}`);
}
