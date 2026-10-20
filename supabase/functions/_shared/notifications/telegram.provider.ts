/**
 * Telegram Bot API notification provider (HTML + inline URL buttons).
 *
 * Secrets:
 *   TELEGRAM_BOT_TOKEN
 */

import {
  escapeHtml,
  formatDateInIst,
  PUC_LEGAL_WARNING_PLAIN,
  type ComplianceAlertPayload,
  type INotificationProvider,
  type InlineUrlButton,
  type NotificationSendResult,
} from './types.ts';

export class TelegramProviderError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'TelegramProviderError';
    this.status = status;
    this.details = details;
  }
}

function requireBotToken(): string {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  if (!token) {
    throw new TelegramProviderError('Missing required env: TELEGRAM_BOT_TOKEN', 500);
  }
  return token;
}

function buildHtmlBody(payload: ComplianceAlertPayload): string {
  const greeting = payload.ownerName
    ? `Hi ${escapeHtml(payload.ownerName)},`
    : 'Hi,';
  const model = payload.makerModel
    ? ` (${escapeHtml(payload.makerModel)})`
    : '';
  const expiryLine = payload.pucExpiryDate
    ? `Valid until: ${escapeHtml(formatDateInIst(payload.pucExpiryDate))}`
    : 'Valid until: unknown';

  let headline: string;
  if (payload.urgency === 'EXPIRED') {
    headline = '🔴 <b>PUC Expired Today</b>';
  } else if (payload.urgency === 'T1') {
    headline = '🟠 <b>Urgent: PUC expires tomorrow</b>';
  } else {
    headline = `🟡 <b>PUC Expiring Soon</b> — ${payload.daysLeft} days left`;
  }

  const action =
    payload.urgency === 'EXPIRED'
      ? 'Renew your PUC immediately before driving to avoid fines and vehicle detention.'
      : 'Please renew your Pollution Under Control certificate before it expires.';

  return [
    greeting,
    '',
    headline,
    '',
    `Vehicle: <b>${escapeHtml(payload.regNumber)}</b>${model}`,
    expiryLine,
    '',
    action,
    '',
    `⚠️ ${escapeHtml(PUC_LEGAL_WARNING_PLAIN)}`,
    '',
    '<i>VahanKavach proactive alert</i>',
  ].join('\n');
}

function buildInlineKeyboard(
  payload: ComplianceAlertPayload,
): { inline_keyboard: Array<Array<{ text: string; url: string }>> } | undefined {
  const buttons: InlineUrlButton[] = [];
  if (payload.renewUrl) {
    buttons.push({ text: 'Renew PUC', url: payload.renewUrl });
  }
  if (payload.payUrl) {
    buttons.push({ text: 'Pay Challans', url: payload.payUrl });
  }
  if (buttons.length === 0) return undefined;

  // Telegram allows up to 8 buttons per row; keep CTAs on one row when ≤2.
  return {
    inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))],
  };
}

export class TelegramNotificationProvider implements INotificationProvider {
  readonly channel = 'TELEGRAM' as const;

  async sendComplianceAlert(
    payload: ComplianceAlertPayload,
  ): Promise<NotificationSendResult> {
    const chatId = payload.telegramChatId?.trim();
    if (!chatId) {
      throw new TelegramProviderError(
        'telegram_chat_id is missing; link Telegram via /start <token> first',
        422,
      );
    }

    const token = requireBotToken();
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const replyMarkup = buildInlineKeyboard(payload);

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: buildHtmlBody(payload),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const raw: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      console.error('Telegram sendMessage error', res.status, raw);
      throw new TelegramProviderError(
        `Telegram API request failed (${res.status})`,
        res.status,
        raw,
      );
    }

    const ok =
      typeof raw === 'object' &&
      raw !== null &&
      'ok' in raw &&
      (raw as { ok: unknown }).ok === true;

    if (!ok) {
      throw new TelegramProviderError(
        'Telegram API returned ok=false',
        502,
        raw,
      );
    }

    const messageId =
      typeof raw === 'object' &&
      raw !== null &&
      'result' in raw &&
      typeof (raw as { result?: { message_id?: unknown } }).result?.message_id ===
        'number'
        ? String((raw as { result: { message_id: number } }).result.message_id)
        : null;

    return { channel: this.channel, messageId, raw };
  }
}

/** Low-level helper used by telegram-webhook conversational replies. */
export async function telegramSendText(
  chatId: string,
  htmlText: string,
  buttons?: InlineUrlButton[],
): Promise<NotificationSendResult> {
  const token = requireBotToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (buttons && buttons.length > 0) {
    body.reply_markup = {
      inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))],
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new TelegramProviderError(
      `Telegram API request failed (${res.status})`,
      res.status,
      raw,
    );
  }

  const messageId =
    typeof raw === 'object' &&
    raw !== null &&
    'result' in raw &&
    typeof (raw as { result?: { message_id?: unknown } }).result?.message_id ===
      'number'
      ? String((raw as { result: { message_id: number } }).result.message_id)
      : null;

  return { channel: 'TELEGRAM', messageId, raw };
}
