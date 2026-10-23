/**
 * Multi-channel notification Strategy contracts.
 * Providers: Telegram (default), WhatsApp, Signal (signal-cli REST gateway).
 */

export type NotificationChannel = 'TELEGRAM' | 'WHATSAPP' | 'SIGNAL';

export type PucAlertUrgency = 'T7' | 'T1' | 'EXPIRED';

export interface InlineUrlButton {
  text: string;
  url: string;
}

/** Canonical compliance alert payload passed to every INotificationProvider. */
export interface ComplianceAlertPayload {
  userId: string;
  ownerName: string | null;
  regNumber: string;
  makerModel: string | null;
  pucExpiryDate: string | null;
  daysLeft: number;
  urgency: PucAlertUrgency;
  /** Destination fields — dispatcher fills from profiles; providers read their own. */
  phoneNumber: string | null;
  telegramChatId: string | null;
  signalNumber: string | null;
  /** Optional CTA URLs rendered as inline buttons (Telegram) or footer links. */
  renewUrl: string | null;
  payUrl: string | null;
  /** Defaults to PUC when unset (insurance alerts set "Insurance"). */
  alertLabel?: string | null;
}

export interface NotificationSendResult {
  channel: NotificationChannel;
  messageId: string | null;
  raw?: unknown;
}

export interface INotificationProvider {
  readonly channel: NotificationChannel;
  sendComplianceAlert(
    payload: ComplianceAlertPayload,
  ): Promise<NotificationSendResult>;
}

export function pucAlertUrgencyFromDaysLeft(daysLeft: number): PucAlertUrgency {
  if (daysLeft <= 0) return 'EXPIRED';
  if (daysLeft === 1) return 'T1';
  return 'T7';
}

export const PUC_LEGAL_WARNING_PLAIN =
  'Legal notice: Driving without a valid PUC certificate can attract fines under Section 190(2) of the Motor Vehicles Act (up to ₹1,000 first offence / ₹2,000 subsequent) and vehicle detention by traffic police.';

export function formatDateInIst(isoDate: string): string {
  const d = new Date(
    isoDate.length === 10 ? `${isoDate}T00:00:00.000Z` : isoDate,
  );
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/** Escape text for Telegram HTML parse_mode. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain-text compliance alert body (Signal / WhatsApp fallback). */
export function buildPlainComplianceAlert(payload: ComplianceAlertPayload): string {
  const greeting = payload.ownerName ? `Hi ${payload.ownerName},` : 'Hi,';
  const model = payload.makerModel ? ` (${payload.makerModel})` : '';
  const expiryLine = payload.pucExpiryDate
    ? `Valid until: ${formatDateInIst(payload.pucExpiryDate)}`
    : 'Valid until: unknown';

  const label = payload.alertLabel?.trim() || 'PUC';
  let headline: string;
  if (payload.urgency === 'EXPIRED') {
    headline = `🔴 ${label} Expired Today`;
  } else if (payload.urgency === 'T1') {
    headline = `🟠 Urgent: ${label} expires tomorrow`;
  } else {
    headline = `🟡 ${label} Expiring Soon — ${payload.daysLeft} days left`;
  }

  const action =
    payload.urgency === 'EXPIRED'
      ? `Renew your ${label} immediately before driving to avoid fines and vehicle detention.`
      : `Please renew your ${label} before it expires.`;

  const lines = [
    greeting,
    '',
    headline,
    '',
    `Vehicle: ${payload.regNumber}${model}`,
    expiryLine,
    '',
    action,
    '',
    `⚠️ ${PUC_LEGAL_WARNING_PLAIN}`,
  ];

  if (payload.renewUrl) {
    lines.push('', `Renew PUC: ${payload.renewUrl}`);
  }
  if (payload.payUrl) {
    lines.push(`Pay Challans: ${payload.payUrl}`);
  }

  lines.push('', 'VahanKavach proactive alert');
  return lines.join('\n');
}

/**
 * Normalize to E.164 for Signal. Accepts +91…, 91…, or 10-digit Indian mobiles.
 * Returns null when the value cannot be normalized.
 */
export function normalizeE164Phone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    const rest = digits.slice(1).replace(/\D/g, '');
    if (rest.length >= 10 && rest.length <= 15) return `+${rest}`;
    return null;
  }

  const only = digits.replace(/\D/g, '');
  if (only.length === 10 && /^[6-9]/.test(only)) return `+91${only}`;
  if (only.length === 12 && only.startsWith('91')) return `+${only}`;
  if (only.length >= 10 && only.length <= 15) return `+${only}`;
  return null;
}
