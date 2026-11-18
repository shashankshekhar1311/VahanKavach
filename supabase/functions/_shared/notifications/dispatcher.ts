/**
 * NotificationDispatcher — Strategy Pattern entrypoint.
 * Reads preferred_channel (default TELEGRAM) and routes to the matching provider.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { SignalNotificationProvider } from './signal.provider.ts';
import { TelegramNotificationProvider } from './telegram.provider.ts';
import {
  pucAlertUrgencyFromDaysLeft,
  type AlertType,
  type ComplianceAlertPayload,
  type INotificationProvider,
  type NotificationChannel,
  type NotificationSendResult,
  type PucAlertUrgency,
  type RcContactWarningPayload,
} from './types.ts';
import { WhatsAppNotificationProvider } from './whatsapp.provider.ts';
import { PARIVAHAN_MOBILE_UPDATE_URL } from '../providers/contact-compliance.ts';

export interface DispatchInput {
  userId: string;
  ownerName: string | null;
  preferredChannel: NotificationChannel | null;
  phoneNumber: string | null;
  telegramChatId: string | null;
  signalNumber: string | null;
  regNumber: string;
  makerModel: string | null;
  pucExpiryDate: string | null;
  daysLeft: number;
  renewUrl?: string | null;
  payUrl?: string | null;
  alertLabel?: string | null;
  /** Defaults to PUC. Use RC_CONTACT_WARNING for seeding audit alerts. */
  alertType?: AlertType;
  maskedMobile?: string | null;
  warningNotice?: string | null;
}

export interface DispatchResult extends NotificationSendResult {
  urgency: PucAlertUrgency;
  preferredChannel: NotificationChannel;
  alertType: AlertType;
}

export class NotificationDispatcher {
  private readonly providers: Map<NotificationChannel, INotificationProvider>;

  constructor(providers?: Partial<Record<NotificationChannel, INotificationProvider>>) {
    this.providers = new Map([
      ['TELEGRAM', providers?.TELEGRAM ?? new TelegramNotificationProvider()],
      ['WHATSAPP', providers?.WHATSAPP ?? new WhatsAppNotificationProvider()],
      ['SIGNAL', providers?.SIGNAL ?? new SignalNotificationProvider()],
    ]);
  }

  /** Route a compliance alert to the user's preferred channel. */
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const alertType: AlertType = input.alertType ?? 'PUC';
    if (alertType === 'RC_CONTACT_WARNING') {
      return this.dispatchRcContactWarning(input);
    }

    const preferredChannel = resolveDispatchChannel(input);
    const provider = this.providers.get(preferredChannel);
    if (!provider) {
      throw new Error(`No notification provider registered for ${preferredChannel}`);
    }

    const urgency = pucAlertUrgencyFromDaysLeft(input.daysLeft);
    const appBase = (
      Deno.env.get('APP_BASE_URL')?.trim() || 'https://vahankavach.app'
    ).replace(/\/$/, '');
    const payPortal =
      Deno.env.get('PAYMENT_PORTAL_URL')?.trim() || `${appBase}/challans/pay`;

    const payload: ComplianceAlertPayload = {
      userId: input.userId,
      ownerName: input.ownerName,
      regNumber: input.regNumber,
      makerModel: input.makerModel,
      pucExpiryDate: input.pucExpiryDate,
      daysLeft: input.daysLeft,
      urgency,
      phoneNumber: input.phoneNumber,
      telegramChatId: input.telegramChatId,
      signalNumber: input.signalNumber,
      renewUrl: input.renewUrl ?? `${appBase}/dashboard`,
      payUrl: input.payUrl ?? payPortal,
      alertLabel: input.alertLabel ?? (alertType === 'INSURANCE' ? 'Insurance' : 'PUC'),
      alertType,
    };

    const result = await provider.sendComplianceAlert(payload);
    return {
      ...result,
      urgency,
      preferredChannel,
      alertType,
    };
  }

  /** Dedicated RC contact / Aadhaar seeding warning. */
  async dispatchRcContactWarning(
    input: Omit<DispatchInput, 'daysLeft' | 'pucExpiryDate'> & {
      daysLeft?: number;
      pucExpiryDate?: string | null;
    },
  ): Promise<DispatchResult> {
    const preferredChannel = resolveDispatchChannel(input);
    const provider = this.providers.get(preferredChannel);
    if (!provider) {
      throw new Error(`No notification provider registered for ${preferredChannel}`);
    }

    const updateUrl =
      input.renewUrl?.trim() || PARIVAHAN_MOBILE_UPDATE_URL;

    const rcPayload: RcContactWarningPayload = {
      userId: input.userId,
      ownerName: input.ownerName,
      regNumber: input.regNumber,
      makerModel: input.makerModel,
      phoneNumber: input.phoneNumber,
      telegramChatId: input.telegramChatId,
      signalNumber: input.signalNumber,
      maskedMobile: input.maskedMobile,
      warningNotice: input.warningNotice,
      updateUrl,
    };

    let result: NotificationSendResult;
    if (provider.sendRcContactWarning) {
      result = await provider.sendRcContactWarning(rcPayload);
    } else {
      // Fallback: route through compliance alert with RC kind.
      result = await provider.sendComplianceAlert({
        userId: input.userId,
        ownerName: input.ownerName,
        regNumber: input.regNumber,
        makerModel: input.makerModel,
        pucExpiryDate: input.pucExpiryDate ?? null,
        daysLeft: input.daysLeft ?? 0,
        urgency: 'T7',
        phoneNumber: input.phoneNumber,
        telegramChatId: input.telegramChatId,
        signalNumber: input.signalNumber,
        renewUrl: updateUrl,
        payUrl: null,
        alertLabel: 'RC Contact',
        alertType: 'RC_CONTACT_WARNING',
      });
    }

    return {
      ...result,
      urgency: 'T7',
      preferredChannel,
      alertType: 'RC_CONTACT_WARNING',
    };
  }

  /**
   * Convenience: load profile channel fields then dispatch.
   * Throws if the profile row is missing.
   */
  async dispatchForUser(
    supabase: SupabaseClient,
    userId: string,
    alert: Omit<
      DispatchInput,
      | 'userId'
      | 'ownerName'
      | 'preferredChannel'
      | 'phoneNumber'
      | 'telegramChatId'
      | 'signalNumber'
    >,
  ): Promise<DispatchResult> {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, full_name, phone_number, preferred_channel, telegram_chat_id, signal_number',
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load profile for dispatch: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Profile not found for user ${userId}`);
    }

    const row = data as {
      id: string;
      full_name: string | null;
      phone_number: string | null;
      preferred_channel: NotificationChannel | null;
      telegram_chat_id: string | null;
      signal_number: string | null;
    };

    return this.dispatch({
      userId: row.id,
      ownerName: row.full_name,
      preferredChannel: row.preferred_channel,
      phoneNumber: row.phone_number,
      telegramChatId: row.telegram_chat_id,
      signalNumber: row.signal_number,
      ...alert,
    });
  }
}

function normalizeChannel(
  channel: NotificationChannel | string | null | undefined,
): NotificationChannel {
  const upper = (channel ?? 'TELEGRAM').toString().toUpperCase();
  if (upper === 'WHATSAPP' || upper === 'SIGNAL' || upper === 'TELEGRAM') {
    return upper;
  }
  return 'TELEGRAM';
}

/** WhatsApp and Signal are parked in the app → always deliver via Telegram. */
function resolveDispatchChannel(input: {
  preferredChannel: NotificationChannel | null;
}): NotificationChannel {
  const preferred = normalizeChannel(input.preferredChannel);

  if (preferred === 'WHATSAPP' || preferred === 'SIGNAL') {
    console.warn(
      `[NotificationDispatcher] ${preferred} parked — falling back to TELEGRAM`,
    );
    return 'TELEGRAM';
  }

  return preferred;
}

/** Singleton used by edge functions. */
export const notificationDispatcher = new NotificationDispatcher();
