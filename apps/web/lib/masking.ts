import { formatRegDisplay, sanitizeRegInput } from "@/lib/registration";

/**
 * Mask a plate for shared / preview contexts (screenshots, referrals, social).
 * Example: "KA01AB1234" → "KA 01 ** ****"
 */
export function maskPlateForPreview(raw: string): string {
  const s = sanitizeRegInput(raw);
  if (s.length < 4) return "****";

  const state = s.slice(0, 2);
  const rest = s.slice(2);

  let rto = "";
  let afterRto = "";
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (/\d/.test(ch) && rto.length < 2 && afterRto.length === 0) {
      rto += ch;
    } else {
      afterRto = rest.slice(i);
      break;
    }
  }

  if (!rto) {
    return `${state} ** ****`;
  }

  return `${state} ${rto} ** ****`;
}

/**
 * Mask last-5 identifiers for UI (never show more than stored).
 * Example: "A1B2C" → "**B2C"
 */
export function maskLast5(raw: string | null | undefined): string {
  if (!raw) return "*****";
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length <= 2) return "*".repeat(Math.max(cleaned.length, 1));
  return `${"*".repeat(cleaned.length - 3)}${cleaned.slice(-3)}`;
}

/** Display form when full plate is allowed in the owner's private garage. */
export function displayPlateOrMasked(
  raw: string,
  { sharedPreview = false }: { sharedPreview?: boolean } = {},
): string {
  if (sharedPreview) return maskPlateForPreview(raw);
  return formatRegDisplay(raw);
}
