/**
 * razorpay-webhook — payment.captured / order.paid
 *
 * 1) Kavach Pro annual (`public.orders`) → status SUCCESS + profiles.is_pro
 * 2) Per-vehicle prepaid (`payment_attempts`) → activate entitlements
 *
 * verify_jwt = false; validates X-Razorpay-Signature (HMAC SHA256).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ANNUAL_PREPAID_RUPEES_PER_VEHICLE } from '../_shared/billing/config.ts';
import { activatePaidPeriod } from '../_shared/billing/entitlements.ts';
import { verifyWebhookSignature } from '../_shared/billing/razorpay.ts';
import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import type { ApiResponse } from '../_shared/types.ts';


type RazorpayWebhookEvent = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        status?: string;
        notes?: Record<string, string>;
      };
    };
    order?: {
      entity?: {
        id?: string;
        amount?: number;
        status?: string;
        notes?: Record<string, string>;
      };
    };
  };
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed' } satisfies ApiResponse<never>,
      405,
    );
  }

  try {
    const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')?.trim();
    const bodyText = await req.text();
    const signature = req.headers.get('X-Razorpay-Signature')?.trim() ?? '';

    if (secret) {
      const valid = await verifyWebhookSignature(bodyText, signature, secret);
      if (!valid) {
        return jsonResponse(
          { success: false, error: 'Invalid signature' } satisfies ApiResponse<never>,
          401,
        );
      }
    } else {
      console.warn('RAZORPAY_WEBHOOK_SECRET unset — skipping signature check');
    }

    const event = JSON.parse(bodyText) as RazorpayWebhookEvent;

    // Acknowledge immediately for unrelated events (still 200).
    if (event.event !== 'payment.captured' && event.event !== 'order.paid') {
      return jsonResponse({ success: true, data: { ignored: event.event ?? null } });
    }

    const payment = event.payload?.payment?.entity;
    const orderEntity = event.payload?.order?.entity;
    const orderId = payment?.order_id ?? orderEntity?.id;
    const paymentId = payment?.id ?? null;

    if (!orderId) {
      // Still 200 so Razorpay does not retry forever on malformed payloads we cannot fix.
      return jsonResponse({ success: true, data: { skipped: 'missing_order_id' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const proResult = await activateKavachProOrder(admin, orderId, paymentId);
    if (proResult.matched) {
      return jsonResponse({ success: true, data: proResult });
    }

    const vehicleResult = await activateVehicleSubscription(admin, orderId, paymentId);
    return jsonResponse({ success: true, data: vehicleResult });
  } catch (err) {
    console.error('razorpay-webhook', err);
    // Prefer 200 for transient parse issues after signature OK? Spec says return 200 OK
    // immediately on success path; failures that need retry keep 5xx.
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal error',
      } satisfies ApiResponse<never>,
      500,
    );
  }
});

async function activateKavachProOrder(
  admin: SupabaseClient,
  razorpayOrderId: string,
  paymentId: string | null,
): Promise<{
  matched: boolean;
  kind?: 'kavach_pro';
  userId?: string;
  alreadyPaid?: boolean;
}> {
  const { data: order, error } = await admin
    .from('orders')
    .select('id, user_id, status, amount')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!order) return { matched: false };

  const amountRupees = Number(order.amount) || ANNUAL_PREPAID_RUPEES_PER_VEHICLE;
  const vehicleQty = Math.max(
    1,
    Math.round(amountRupees / ANNUAL_PREPAID_RUPEES_PER_VEHICLE),
  );

  if (order.status === 'SUCCESS') {
    await admin.from('profiles').update({ is_pro: true }).eq('id', order.user_id);
    await activatePaidPeriod(
      admin,
      order.user_id as string,
      vehicleQty,
      razorpayOrderId,
    );
    return {
      matched: true,
      kind: 'kavach_pro',
      userId: order.user_id as string,
      alreadyPaid: true,
    };
  }

  const { error: updErr } = await admin
    .from('orders')
    .update({
      status: 'SUCCESS',
      razorpay_payment_id: paymentId,
    })
    .eq('id', order.id);
  if (updErr) throw new Error(updErr.message);

  await activatePaidPeriod(
    admin,
    order.user_id as string,
    vehicleQty,
    razorpayOrderId,
  );

  const { error: proErr } = await admin
    .from('profiles')
    .update({ is_pro: true })
    .eq('id', order.user_id);
  if (proErr) throw new Error(proErr.message);

  return {
    matched: true,
    kind: 'kavach_pro',
    userId: order.user_id as string,
  };
}


async function activateVehicleSubscription(
  admin: SupabaseClient,
  orderId: string,
  paymentId: string | null,
): Promise<Record<string, unknown>> {
  const { data: attempt, error } = await admin
    .from('payment_attempts')
    .select('id, user_id, vehicle_qty, status, kind')
    .eq('razorpay_order_id', orderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!attempt) {
    console.warn('No orders / payment_attempt for order', orderId);
    return { unmatched: true };
  }

  if (attempt.status === 'paid') {
    return { alreadyPaid: true, kind: attempt.kind };
  }

  if (attempt.kind !== 'subscription') {
    await admin
      .from('payment_attempts')
      .update({
        status: 'paid',
        razorpay_payment_id: paymentId,
      })
      .eq('id', attempt.id);
    return { kind: attempt.kind };
  }

  const qty = attempt.vehicle_qty ?? 1;
  const activated = await activatePaidPeriod(
    admin,
    attempt.user_id as string,
    qty,
    orderId,
  );

  await admin
    .from('payment_attempts')
    .update({
      status: 'paid',
      razorpay_payment_id: paymentId,
    })
    .eq('id', attempt.id);

  return {
    kind: 'subscription',
    userId: attempt.user_id,
    periodEnd: activated.periodEnd,
    entitled: activated.entitled,
  };
}
