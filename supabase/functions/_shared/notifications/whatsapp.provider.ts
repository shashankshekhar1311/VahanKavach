/**
 * WhatsApp Cloud API notification provider (INotificationProvider adapter).
 * Reuses the shared Meta Graph client for templates / text.
 *
 * Secrets: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 * Optional: WHATSAPP_PUC_TEMPLATE_NAME, WHATSAPP_PUC_TEMPLATE_LANG
 */

import {
  formatPucAlertText,
  sendTemplateMessage,
  sendTextMessage,
  WhatsAppClientError,
} from '../whatsapp.client.ts';
import type {
  ComplianceAlertPayload,
  INotificationProvider,
  NotificationSendResult,
} from './types.ts';

export { WhatsAppClientError };

export class WhatsAppNotificationProvider implements INotificationProvider {
  readonly channel = 'WHATSAPP' as const;

  async sendComplianceAlert(
    payload: ComplianceAlertPayload,
  ): Promise<NotificationSendResult> {
    const phone = payload.phoneNumber?.trim() ?? null;
    if (!phone) {
      throw new WhatsAppClientError(
        'Owner phone_number is missing; cannot send WhatsApp alert',
        422,
      );
    }

    const templateName = Deno.env.get('WHATSAPP_PUC_TEMPLATE_NAME')?.trim();

    if (templateName) {
      const lang =
        Deno.env.get('WHATSAPP_PUC_TEMPLATE_LANG')?.trim() || 'en';
      const result = await sendTemplateMessage(phone, templateName, lang, [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: payload.regNumber },
            {
              type: 'text',
              text:
                payload.urgency === 'EXPIRED'
                  ? 'expired today'
                  : payload.urgency === 'T1'
                    ? 'expires tomorrow'
                    : `expires in ${payload.daysLeft} days`,
            },
            {
              type: 'text',
              text: payload.pucExpiryDate ?? 'unknown',
            },
          ],
        },
      ]);
      return {
        channel: this.channel,
        messageId: result.messageId,
        raw: result.raw,
      };
    }

    const text = formatPucAlertText({
      daysLeft: payload.daysLeft,
      regNumber: payload.regNumber,
      makerModel: payload.makerModel,
      pucExpiryDate: payload.pucExpiryDate,
      ownerName: payload.ownerName,
    });

    const footerLinks: string[] = [];
    if (payload.renewUrl) footerLinks.push(`Renew PUC: ${payload.renewUrl}`);
    if (payload.payUrl) footerLinks.push(`Pay challans: ${payload.payUrl}`);
    const body =
      footerLinks.length > 0 ? `${text}\n\n${footerLinks.join('\n')}` : text;

    const result = await sendTextMessage(phone, body);
    return {
      channel: this.channel,
      messageId: result.messageId,
      raw: result.raw,
    };
  }
}
