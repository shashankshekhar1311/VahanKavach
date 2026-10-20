/**
 * Indian vehicle registration sanitization, validation, and display mask.
 * Stored form: KA01AB1234 · Display form: KA 01 AB 1234
 */

const REG_PATTERN = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

/** Strip separators and uppercase. Does not validate. */
export function sanitizeRegInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function isValidRegNumber(raw: string): boolean {
  return REG_PATTERN.test(sanitizeRegInput(raw));
}

/**
 * Progressive display mask while typing.
 * e.g. "KA01AB1234" → "KA 01 AB 1234"
 */
export function formatRegDisplay(raw: string): string {
  const s = sanitizeRegInput(raw).slice(0, 11);
  if (s.length === 0) return "";

  const state = s.slice(0, 2);
  const rest = s.slice(2);

  // RTO: 1–2 digits
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

  // Series letters (0–3) then 4 digits
  let series = "";
  let number = "";
  for (const ch of afterRto) {
    if (/[A-Z]/.test(ch) && number.length === 0 && series.length < 3) {
      series += ch;
    } else if (/\d/.test(ch) && number.length < 4) {
      number += ch;
    }
  }

  const parts = [state];
  if (rto) parts.push(rto);
  if (series) parts.push(series);
  if (number) parts.push(number);
  return parts.join(" ");
}

/** Canonical stored registration or null if invalid. */
export function toStoredRegNumber(raw: string): string | null {
  const sanitized = sanitizeRegInput(raw);
  return REG_PATTERN.test(sanitized) ? sanitized : null;
}
