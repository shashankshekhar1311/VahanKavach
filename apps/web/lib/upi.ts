/**
 * Build a UPI intent deep-link for challan settlement.
 * Falls back to Parivahan e-challan portal when UPI params are incomplete.
 */

const DEFAULT_VPA = process.env.NEXT_PUBLIC_UPI_VPA ?? "vahankavach@upi";
const PARIVAHAN_URL = "https://echallan.parivahan.gov.in/";

export interface UpiPayParams {
  amount: number;
  note: string;
  payeeName?: string;
  vpa?: string;
}

export function buildUpiDeepLink(params: UpiPayParams): string {
  const pa = params.vpa ?? DEFAULT_VPA;
  const pn = encodeURIComponent(params.payeeName ?? "VahanKavach");
  const am = params.amount.toFixed(2);
  const tn = encodeURIComponent(params.note.slice(0, 80));
  return `upi://pay?pa=${encodeURIComponent(pa)}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
}

export function getParivahanPortalUrl(): string {
  return PARIVAHAN_URL;
}

/** Open UPI intent; if the scheme is unsupported, open Parivahan portal. */
export function openPayment(params: UpiPayParams): void {
  const upi = buildUpiDeepLink(params);
  const opened = window.open(upi, "_blank");
  if (!opened) {
    window.location.href = upi;
  }
  // Desktop browsers often ignore upi:// — offer portal after a beat
  window.setTimeout(() => {
    if (document.hasFocus()) {
      window.open(getParivahanPortalUrl(), "_blank", "noopener,noreferrer");
    }
  }, 800);
}
