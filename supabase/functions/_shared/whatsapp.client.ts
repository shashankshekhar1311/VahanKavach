/**
 * Meta WhatsApp Cloud API (Graph v21+) outbound client.
 *
 * Required secrets:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_PHONE_NUMBER_ID
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppSendResult {
  messageId: string | null;
  raw: unknown;
}

export class WhatsAppClientError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'WhatsAppClientError';
    this.status = status;
    this.details = details;
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new WhatsAppClientError(`Missing required env: ${name}`, 500);
  }
  return value;
}

/** Strip leading + for the Cloud API `to` field. */
export function toWhatsAppRecipient(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '').replace(/\D/g, '');
}

async function postMessages(
  body: Record<string, unknown>,
  opts: { includeRecipientType?: boolean } = {},
): Promise<WhatsAppSendResult> {
  const token = requireEnv('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    ...body,
  };
  if (opts.includeRecipientType !== false && body.to) {
    payload.recipient_type = 'individual';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    console.error('WhatsApp Cloud API error', res.status, raw);
    throw new WhatsAppClientError(
      `WhatsApp API request failed (${res.status})`,
      res.status,
      raw,
    );
  }

  const messageId =
    typeof raw === 'object' &&
    raw !== null &&
    'messages' in raw &&
    Array.isArray((raw as { messages?: unknown }).messages) &&
    typeof (raw as { messages: Array<{ id?: unknown }> }).messages[0]?.id === 'string'
      ? (raw as { messages: Array<{ id: string }> }).messages[0].id
      : null;

  return { messageId, raw };
}

/** Send a plain text message. */
export async function sendTextMessage(
  toPhoneE164: string,
  text: string,
): Promise<WhatsAppSendResult> {
  return postMessages({
    to: toWhatsAppRecipient(toPhoneE164),
    type: 'text',
    text: { preview_url: true, body: text },
  });
}

/**
 * Send an interactive reply-button message (max 3 buttons; title ≤ 20 chars).
 */
export async function sendInteractiveButtons(
  toPhoneE164: string,
  bodyText: string,
  buttons: WhatsAppButton[],
  headerText?: string,
  footerText?: string,
): Promise<WhatsAppSendResult> {
  if (buttons.length === 0 || buttons.length > 3) {
    throw new WhatsAppClientError(
      'Interactive button messages require 1–3 buttons.',
      400,
    );
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: {
          id: b.id.slice(0, 256),
          title: b.title.slice(0, 20),
        },
      })),
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: headerText.slice(0, 60) };
  }
  if (footerText) {
    interactive.footer = { text: footerText.slice(0, 60) };
  }

  return postMessages({
    to: toWhatsAppRecipient(toPhoneE164),
    type: 'interactive',
    interactive,
  });
}

/** Mark an inbound message as read (blue ticks). */
export async function markMessageAsRead(messageId: string): Promise<WhatsAppSendResult> {
  return postMessages(
    {
      status: 'read',
      message_id: messageId,
    },
    { includeRecipientType: false },
  );
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters?: Array<{
    type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
    text?: string;
  }>;
  sub_type?: string;
  index?: string;
}

/**
 * Send an approved Meta template (HSM) — required for proactive outbound
 * outside the 24-hour customer-care window.
 */
export async function sendTemplateMessage(
  toPhoneE164: string,
  templateName: string,
  languageCode: string,
  components: WhatsAppTemplateComponent[] = [],
): Promise<WhatsAppSendResult> {
  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  };
  if (components.length > 0) {
    template.components = components;
  }

  return postMessages({
    to: toWhatsAppRecipient(toPhoneE164),
    type: 'template',
    template,
  });
}

/** Shared Motor Vehicles Act PUC legal footer (Module 3 / Module 4). */
export const PUC_LEGAL_WARNING =
  '⚠️ Legal notice: Driving without a valid PUC certificate can attract fines under Section 190(2) of the Motor Vehicles Act (up to ₹1,000 first offence / ₹2,000 subsequent) and vehicle detention by traffic police.';

export type PucAlertUrgency = 'T7' | 'T1' | 'EXPIRED';

export function pucAlertUrgencyFromDaysLeft(daysLeft: number): PucAlertUrgency {
  if (daysLeft <= 0) return 'EXPIRED';
  if (daysLeft === 1) return 'T1';
  return 'T7';
}

/** Format the proactive PUC WhatsApp body used by send-puc-alert. */
export function formatPucAlertText(input: {
  daysLeft: number;
  regNumber: string;
  makerModel: string | null;
  pucExpiryDate: string | null;
  ownerName: string | null;
}): string {
  const urgency = pucAlertUrgencyFromDaysLeft(input.daysLeft);
  const greeting = input.ownerName ? `Hi ${input.ownerName},` : 'Hi,';
  const model = input.makerModel ? ` (${input.makerModel})` : '';
  const expiryLine = input.pucExpiryDate
    ? `Valid until: ${formatDateInIst(input.pucExpiryDate)}`
    : 'Valid until: unknown';

  let headline: string;
  if (urgency === 'EXPIRED') {
    headline = '🔴 *PUC Expired Today*';
  } else if (urgency === 'T1') {
    headline = '🟠 *Urgent: PUC expires tomorrow*';
  } else {
    headline = `🟡 *PUC Expiring Soon* — ${input.daysLeft} days left`;
  }

  return [
    greeting,
    '',
    headline,
    '',
    `Vehicle: *${input.regNumber}*${model}`,
    expiryLine,
    '',
    urgency === 'EXPIRED'
      ? 'Renew your PUC immediately before driving to avoid fines and vehicle detention.'
      : 'Please renew your Pollution Under Control certificate before it expires.',
    '',
    PUC_LEGAL_WARNING,
    '',
    '_VahanKavach proactive alert_',
  ].join('\n');
}

function formatDateInIst(isoDate: string): string {
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
