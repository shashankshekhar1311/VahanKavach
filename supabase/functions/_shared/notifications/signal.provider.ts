/**
 * Signal notification provider via signal-cli-rest-api (or compatible gateway).
 *
 * When preferred_channel=SIGNAL and signal_number is linked, sends a formatted
 * compliance alert to POST {SIGNAL_GATEWAY_URL}/v2/send.
 *
 * Secrets:
 *   SIGNAL_GATEWAY_URL   — base URL (e.g. https://signal.example.com) or full …/v2/send
 *   SIGNAL_SENDER_NUMBER — registered signal-cli account in E.164 (e.g. +91…)
 *   SIGNAL_GATEWAY_TOKEN — optional Bearer token
 */

import {
  buildPlainComplianceAlert,
  normalizeE164Phone,
  type ComplianceAlertPayload,
  type INotificationProvider,
  type NotificationSendResult,
} from './types.ts';

export class SignalProviderError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'SignalProviderError';
    this.status = status;
    this.details = details;
  }
}

function resolveSendUrl(gateway: string): string {
  const base = gateway.replace(/\/$/, '');
  if (/\/v2\/send$/i.test(base)) return base;
  return `${base}/v2/send`;
}

export class SignalNotificationProvider implements INotificationProvider {
  readonly channel = 'SIGNAL' as const;

  async sendComplianceAlert(
    payload: ComplianceAlertPayload,
  ): Promise<NotificationSendResult> {
    const to = normalizeE164Phone(payload.signalNumber);
    if (!to) {
      throw new SignalProviderError(
        'signal_number is missing or invalid; link a Signal number first',
        422,
      );
    }

    const gateway = Deno.env.get('SIGNAL_GATEWAY_URL')?.trim();
    if (!gateway) {
      throw new SignalProviderError(
        'SIGNAL_GATEWAY_URL is not configured',
        503,
      );
    }

    const sender = normalizeE164Phone(Deno.env.get('SIGNAL_SENDER_NUMBER'));
    if (!sender) {
      throw new SignalProviderError(
        'SIGNAL_SENDER_NUMBER is missing or invalid (E.164 required)',
        500,
      );
    }

    const message = buildPlainComplianceAlert(payload);
    const url = resolveSendUrl(gateway);
    const body = {
      message,
      number: sender,
      recipients: [to],
      text_mode: 'normal' as const,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = Deno.env.get('SIGNAL_GATEWAY_TOKEN')?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const raw: unknown = await res.json().catch(() => null);
    // signal-cli-rest-api returns 201 on success
    if (!res.ok) {
      console.error('Signal gateway error', res.status, raw);
      throw new SignalProviderError(
        `Signal gateway request failed (${res.status})`,
        res.status,
        raw,
      );
    }

    const messageId =
      typeof raw === 'object' &&
      raw !== null &&
      'timestamp' in raw &&
      (typeof (raw as { timestamp?: unknown }).timestamp === 'string' ||
        typeof (raw as { timestamp?: unknown }).timestamp === 'number')
        ? String((raw as { timestamp: string | number }).timestamp)
        : typeof raw === 'object' &&
            raw !== null &&
            'messageId' in raw &&
            typeof (raw as { messageId?: unknown }).messageId === 'string'
          ? (raw as { messageId: string }).messageId
          : `signal-${crypto.randomUUID()}`;

    return { channel: this.channel, messageId, raw };
  }
}
