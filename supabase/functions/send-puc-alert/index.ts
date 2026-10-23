/**
 * send-puc-alert — Module 4
 *
 * Invoked by pg_cron → pg_net (service-role Bearer). Loads vehicle + owner,
 * formats the PUC warning, and dispatches via NotificationDispatcher
 * (preferred_channel → Telegram / WhatsApp / Signal).
 *
 * Staging (ENVIRONMENT=staging): Telegram bodies are prefixed with
 * `[SANDBOX TEST ALERT]` inside TelegramNotificationProvider.
 *
 * Body: { vehicleId, daysLeft, alertKind?: "PUC"|"INSURANCE" }
 *   daysLeft 7 → T-7 warning
 *   daysLeft 1 → T-1 urgent
 *   daysLeft 0 → expired today
 * Requires active vehicle_entitlements.
 *
 * ---------------------------------------------------------------------------
 * Secrets (local: supabase/functions/.env | hosted: supabase secrets set)
 * ---------------------------------------------------------------------------
 *   ENVIRONMENT                     — staging | production
 *   TELEGRAM_BOT_TOKEN              — default channel
 *   WHATSAPP_ACCESS_TOKEN           — WhatsApp fallback / preference
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_PUC_TEMPLATE_NAME      — optional Meta HSM (WhatsApp only)
 *   WHATSAPP_PUC_TEMPLATE_LANG      — default en
 *   SIGNAL_GATEWAY_URL              — optional Signal REST gateway
 *   APP_BASE_URL / PAYMENT_PORTAL_URL — CTA links
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * verify_jwt = false — auth is the service-role Bearer checked in-handler
 * (pg_net / vault key may be JWT or sb_secret_*).
 *
 * ---------------------------------------------------------------------------
 * curl examples (local: http://127.0.0.1:54321)
 * ---------------------------------------------------------------------------
 *
 * curl -s -X POST 'http://127.0.0.1:54321/functions/v1/send-puc-alert' \
 *   -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
 *   -H 'Content-Type: application/json' \
 *   -d '{"vehicleId":"b1111111-1111-4111-8111-111111111111","daysLeft":7}'
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import {
  notificationDispatcher,
} from '../_shared/notifications/dispatcher.ts';
import { SignalProviderError } from '../_shared/notifications/signal.provider.ts';
import { TelegramProviderError } from '../_shared/notifications/telegram.provider.ts';
import {
  pucAlertUrgencyFromDaysLeft,
  type NotificationChannel,
  type PucAlertUrgency,
} from '../_shared/notifications/types.ts';
import { WhatsAppClientError } from '../_shared/notifications/whatsapp.provider.ts';
import type { ApiResponse } from '../_shared/types.ts';
import {
  getEntitlement,
  isEntitlementActive,
} from '../_shared/billing/entitlements.ts';

const RequestSchema = z.object({
  vehicleId: z.string().uuid('vehicleId must be a UUID'),
  daysLeft: z.number().int().min(0).max(30),
  alertKind: z.enum(['PUC', 'INSURANCE']).optional().default('PUC'),
});

interface VehicleOwnerRow {
  id: string;
  user_id: string;
  reg_number: string;
  maker_model: string | null;
  puc_expiry_date: string | null;
  insurance_expiry_date: string | null;
  profiles: {
    phone_number: string | null;
    full_name: string | null;
    preferred_channel: NotificationChannel | null;
    telegram_chat_id: string | null;
    signal_number: string | null;
  } | null;
}

interface SendPucAlertData {
  vehicleId: string;
  regNumber: string;
  daysLeft: number;
  urgency: PucAlertUrgency;
  channel: NotificationChannel;
  messageId: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }

  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed' } satisfies ApiResponse<never>,
      405,
    );
  }

  if (!authorizeServiceRole(req)) {
    return jsonResponse(
      { success: false, error: 'Unauthorized' } satisfies ApiResponse<never>,
      401,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { success: false, error: 'Invalid JSON body' } satisfies ApiResponse<never>,
      400,
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        success: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      } satisfies ApiResponse<never>,
      400,
    );
  }

  const { vehicleId, daysLeft, alertKind } = parsed.data;
  const urgency = pucAlertUrgencyFromDaysLeft(daysLeft);

  try {
    const supabase = createServiceClient();
    const vehicle = await fetchVehicleWithOwner(supabase, vehicleId);

    if (!vehicle) {
      return jsonResponse(
        { success: false, error: 'Vehicle not found' } satisfies ApiResponse<never>,
        404,
      );
    }

    const ent = await getEntitlement(supabase, vehicleId);
    if (!ent || !isEntitlementActive(ent.active_until)) {
      return jsonResponse(
        {
          success: false,
          error: 'Vehicle entitlement inactive — skipping alert',
        } satisfies ApiResponse<never>,
        402,
      );
    }

    const profile = vehicle.profiles;
    if (!profile) {
      return jsonResponse(
        { success: false, error: 'Vehicle owner profile missing' } satisfies ApiResponse<never>,
        422,
      );
    }

    if (!profile.telegram_chat_id && !profile.phone_number) {
      return jsonResponse(
        {
          success: false,
          error: 'No Telegram chat or phone on profile — cannot deliver alert',
        } satisfies ApiResponse<never>,
        422,
      );
    }

    const expiryDate =
      alertKind === 'INSURANCE'
        ? vehicle.insurance_expiry_date
        : vehicle.puc_expiry_date;

    const environment = (Deno.env.get('ENVIRONMENT') ?? 'production').trim();
    console.log('send-puc-alert dispatch', {
      vehicleId,
      regNumber: vehicle.reg_number,
      daysLeft,
      alertKind,
      environment,
    });

    const result = await notificationDispatcher.dispatch({
      userId: vehicle.user_id,
      ownerName: profile.full_name,
      preferredChannel: profile.preferred_channel,
      phoneNumber: profile.phone_number,
      telegramChatId: profile.telegram_chat_id,
      signalNumber: profile.signal_number,
      regNumber: vehicle.reg_number,
      makerModel: vehicle.maker_model,
      pucExpiryDate: expiryDate,
      daysLeft,
      alertLabel: alertKind === 'INSURANCE' ? 'Insurance' : 'PUC',
    });

    const data: SendPucAlertData = {
      vehicleId,
      regNumber: vehicle.reg_number,
      daysLeft,
      urgency: result.urgency ?? urgency,
      channel: result.channel,
      messageId: result.messageId,
    };

    console.log('send-puc-alert dispatched', {
      ...data,
      sandboxPrefix:
        environment.toLowerCase() === 'staging' ||
        environment.toLowerCase() === 'sandbox',
    });

    return jsonResponse(
      { success: true, data } satisfies ApiResponse<SendPucAlertData>,
      200,
    );
  } catch (err) {
    if (
      err instanceof WhatsAppClientError ||
      err instanceof TelegramProviderError ||
      err instanceof SignalProviderError
    ) {
      console.error('send-puc-alert provider error', err.name, err.status, err.details);
      return jsonResponse(
        {
          success: false,
          error: err.message,
        } satisfies ApiResponse<never>,
        err.status >= 400 && err.status < 600 ? err.status : 502,
      );
    }

    console.error('send-puc-alert failed', err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal error',
      } satisfies ApiResponse<never>,
      500,
    );
  }
});

function authorizeServiceRole(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!expected) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    return false;
  }

  const auth = req.headers.get('Authorization')?.trim() ?? '';
  if (auth === `Bearer ${expected}`) {
    return true;
  }

  // Some gateways also forward the key as apikey.
  const apikey = req.headers.get('apikey')?.trim() ?? '';
  return apikey === expected;
}

function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchVehicleWithOwner(
  supabase: SupabaseClient,
  vehicleId: string,
): Promise<VehicleOwnerRow | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(
      `
      id,
      user_id,
      reg_number,
      maker_model,
      puc_expiry_date,
      insurance_expiry_date,
      profiles!inner (
        phone_number,
        full_name,
        preferred_channel,
        telegram_chat_id,
        signal_number
      )
    `,
    )
    .eq('id', vehicleId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load vehicle: ${error.message}`);
  }

  return (data as VehicleOwnerRow | null) ?? null;
}
