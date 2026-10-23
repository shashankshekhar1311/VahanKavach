/** Indian +91 mobile helpers. */

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Digits only from a phone field (strips +91 / spaces). */
export function extractIndianMobileDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits.slice(0, 10);
}

export function isValidIndianMobile(raw: string): boolean {
  return INDIAN_MOBILE.test(extractIndianMobileDigits(raw));
}

/** E.164 for Supabase Auth / WhatsApp: +919876543210 */
export function toE164Indian(raw: string): string | null {
  const mobile = extractIndianMobileDigits(raw);
  if (!INDIAN_MOBILE.test(mobile)) return null;
  return `+91${mobile}`;
}

export function formatMobileInput(raw: string): string {
  const digits = extractIndianMobileDigits(raw);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}
