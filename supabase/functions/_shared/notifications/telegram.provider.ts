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
  type RcContactWarningPayload,
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

function isStagingEnvironment(): boolean {
  const env = (Deno.env.get('ENVIRONMENT') ?? Deno.env.get('APP_ENV') ?? '')
    .trim()
    .toLowerCase();
  return env === 'staging' || env === 'sandbox' || env === 'dev';
}

/** Staging prefix appended to all outgoing Telegram alert bodies. */
export function sandboxAlertPrefix(): string {
  return isStagingEnvironment() ? '[SANDBOX TEST ALERT]\n\n' : '';
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

  const label = payload.alertLabel?.trim() || 'PUC';
  let headline: string;
  if (payload.urgency === 'EXPIRED') {
    headline = `🔴 <b>${escapeHtml(label)} Expired Today</b>`;
  } else if (payload.urgency === 'T1') {
    headline = `🟠 <b>Urgent: ${escapeHtml(label)} expires tomorrow</b>`;
  } else {
    headline = `🟡 <b>${escapeHtml(label)} Expiring Soon</b> — ${payload.daysLeft} days left`;
  }

  const action =
    payload.urgency === 'EXPIRED'
      ? `Renew your ${label} immediately before driving to avoid fines and vehicle detention.`
      : `Please renew your ${label} before it expires.`;

  return [
    sandboxAlertPrefix(),
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
  ]
    .filter((line, idx) => !(idx === 0 && line === ''))
    .join('\n');
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

function buildRcContactWarningHtml(payload: RcContactWarningPayload): string {
  const notice = payload.warningNotice
    ? `\n\n<i>${escapeHtml(payload.warningNotice)}</i>`
    : '';
  const model = payload.makerModel
    ? ` (${escapeHtml(payload.makerModel)})`
    : '';

  return [
    sandboxAlertPrefix(),
    '⚠️ <b>VahanKavach Security Warning: Unlinked RC Detected</b>',
    '',
    `🚗 <b>Vehicle:</b> ${escapeHtml(payload.regNumber)}${model}`,
    '',
    '• <b>Status:</b> Mobile number / Aadhaar not linked in official VAHAN records.',
    '• <b>Risk:</b> Transport Department ₹1,000 penalty + silent traffic fines going to court summons.',
    '',
    '👉 <i>Update your mobile number in 2 minutes on the official MoRTH portal:</i>',
    notice,
  ]
    .filter((line, idx) => !(idx === 0 && line === ''))
    .join('\n');
}

async function telegramApiSendMessage(
  chatId: string,
  text: string,
  buttons?: InlineUrlButton[],
): Promise<NotificationSendResult> {
  const token = requireBotToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
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

  return { channel: 'TELEGRAM', messageId, raw };
}

export class TelegramNotificationProvider implements INotificationProvider {
  readonly channel = 'TELEGRAM' as const;

  async sendComplianceAlert(
    payload: ComplianceAlertPayload,
  ): Promise<NotificationSendResult> {
    if (payload.alertType === 'RC_CONTACT_WARNING') {
      return this.sendRcContactWarning({
        userId: payload.userId,
        ownerName: payload.ownerName,
        regNumber: payload.regNumber,
        makerModel: payload.makerModel,
        phoneNumber: payload.phoneNumber,
        telegramChatId: payload.telegramChatId,
        signalNumber: payload.signalNumber,
        updateUrl:
          payload.renewUrl ??
          'https://vahan.parivahan.gov.in/mobileupdate/',
      });
    }

    const chatId = payload.telegramChatId?.trim();
    if (!chatId) {
      throw new TelegramProviderError(
        'telegram_chat_id is missing; open Connect Telegram in the app (t.me/<bot>?start=<token>)',
        422,
      );
    }

    const buttons: InlineUrlButton[] = [];
    if (payload.renewUrl) {
      buttons.push({ text: 'Renew PUC', url: payload.renewUrl });
    }
    if (payload.payUrl) {
      buttons.push({ text: 'Pay Challans', url: payload.payUrl });
    }

    return telegramApiSendMessage(
      chatId,
      buildHtmlBody(payload),
      buttons.length > 0 ? buttons : undefined,
    );
  }

  async sendRcContactWarning(
    payload: RcContactWarningPayload,
  ): Promise<NotificationSendResult> {
    const chatId = payload.telegramChatId?.trim();
    if (!chatId) {
      throw new TelegramProviderError(
        'telegram_chat_id is missing; open Connect Telegram in the app (t.me/<bot>?start=<token>)',
        422,
      );
    }

    return telegramApiSendMessage(chatId, buildRcContactWarningHtml(payload), [
      {
        text: '🌐 Update on Parivahan',
        url: payload.updateUrl || 'https://vahan.parivahan.gov.in/mobileupdate/',
      },
    ]);
  }
}

/** Low-level helper used by telegram-webhook conversational replies. */
export async function telegramSendText(
  chatId: string,
  htmlText: string,
  buttons?: InlineUrlButton[],
  options?: { skipSandboxPrefix?: boolean },
): Promise<NotificationSendResult> {
  const token = requireBotToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const text =
    options?.skipSandboxPrefix || !isStagingEnvironment()
      ? htmlText
      : `${sandboxAlertPrefix()}${htmlText}`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
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
