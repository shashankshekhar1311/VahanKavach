/**
 * Indian vehicle registration sanitization, validation, and display mask.
 * Stored form: KA01AB1234 · Display form: KA 01 AB 1234
 * Bharat Series: 22BH1234AA · Display: 22 BH 1234 AA
 */

const REG_PATTERN = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;
const BHARAT_SERIES_PATTERN = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

/** Strip separators and uppercase. Does not validate. */
export function sanitizeRegInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function isValidRegNumber(raw: string): boolean {
  const s = sanitizeRegInput(raw);
  return REG_PATTERN.test(s) || BHARAT_SERIES_PATTERN.test(s);
}

export function isValidChassisLast5(raw: string): boolean {
  return /^[A-Z0-9]{5}$/.test(raw.toUpperCase().replace(/[^A-Z0-9]/g, ""));
}

/**
 * Progressive display mask while typing.
 * Classic: "KA01AB1234" → "KA 01 AB 1234"
 * Bharat:  "22BH1234AA" → "22 BH 1234 AA"
 */
export function formatRegDisplay(raw: string): string {
  const s = sanitizeRegInput(raw).slice(0, 11);
  if (s.length === 0) return "";

  // Bharat Series starts with digits + BH
  if (/^[0-9]/.test(s)) {
    const yy = s.slice(0, 2);
    const bh = s.slice(2, 4);
    const num = s.slice(4, 8);
    const series = s.slice(8, 10);
    const parts = [yy];
    if (bh) parts.push(bh);
    if (num) parts.push(num);
    if (series) parts.push(series);
    return parts.join(" ");
  }

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
  return isValidRegNumber(sanitized) ? sanitized : null;
}
