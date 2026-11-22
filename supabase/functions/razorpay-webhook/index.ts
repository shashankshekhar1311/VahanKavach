/**
 * razorpay-webhook — payment.captured / order.paid
 *
 * Grants scan credits / plan windows for:
 *   adhoc_audit ₹19/credit · fleet_pass ₹99/vehicle/7d · pro_annual ₹399/vehicle/yr
 *   (order total = unit × vehicle_qty for every paid tier)
 *
 * verify_jwt = false; requires X-Razorpay-Signature (HMAC SHA256 of raw body).
 * Idempotent across retries and dual event delivery (payment.captured + order.paid).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  activatePaidPeriod,
  expandPaidSeats,
} from '../_shared/billing/entitlements.ts';
import {
  grantPlanPurchase,
  markPaymentSuccessful,
  PLAN_PRICE_PAISE,
  type SubscriptionTier,
} from '../_shared/billing/plans.ts';
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
        currency?: string;
        status?: string;
        notes?: Record<string, string>;
      };
    };
    order?: {
      entity?: {
        id?: string;
        amount?: number;
        currency?: string;
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
    // Raw body BEFORE JSON.parse — required for stable HMAC verification.
    const bodyText = await req.text();
    const signature = req.headers.get('X-Razorpay-Signature')?.trim() ?? '';

    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET unset — refusing webhook');
      return jsonResponse(
        { success: false, error: 'Webhook secret not configured' } satisfies ApiResponse<never>,
        503,
      );
    }

    if (!signature) {
      return jsonResponse(
        { success: false, error: 'Missing signature' } satisfies ApiResponse<never>,
        401,
      );
    }

    const valid = await verifyWebhookSignature(bodyText, signature, secret);
    if (!valid) {
      return jsonResponse(
        { success: false, error: 'Invalid signature' } satisfies ApiResponse<never>,
        401,
      );
    }

    const event = JSON.parse(bodyText) as RazorpayWebhookEvent;

    if (event.event !== 'payment.captured' && event.event !== 'order.paid') {
      return jsonResponse({ success: true, data: { ignored: event.event ?? null } });
    }

    const payment = event.payload?.payment?.entity;
    const orderEntity = event.payload?.order?.entity;
    const orderId = payment?.order_id ?? orderEntity?.id ?? null;
    const paymentId = payment?.id ?? null;
    const paidPaise = Number(payment?.amount ?? orderEntity?.amount ?? NaN);
    const currency = String(
      payment?.currency ?? orderEntity?.currency ?? '',
    ).toUpperCase();

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Event-level idempotency (Razorpay may send payment.captured + order.paid).
    const eventId =
      req.headers.get('x-razorpay-event-id')?.trim() ||
      (paymentId
        ? `${event.event}:${paymentId}`
        : orderId
        ? `${event.event}:${orderId}`
        : null);

    let eventClaimed = false;
    if (eventId) {
      const claimed = await claimWebhookEvent(admin, {
        eventId,
        eventType: event.event ?? null,
        paymentId,
        orderId,
      });
      if (!claimed) {
        return jsonResponse({
          success: true,
          data: { duplicate: true, eventId },
        });
      }
      eventClaimed = true;
    }

    try {
      if (!orderId) {
        return jsonResponse({ success: true, data: { skipped: 'missing_order_id' } });
      }

      if (currency !== 'INR') {
        console.error('razorpay-webhook currency rejected', { currency, orderId });
        return jsonResponse({
          success: true,
          data: { rejected: 'currency_mismatch', currency },
        });
      }

      if (!Number.isFinite(paidPaise) || paidPaise <= 0) {
        console.error('razorpay-webhook missing amount', { orderId, paymentId });
        return jsonResponse({
          success: true,
          data: { rejected: 'missing_amount' },
        });
      }

      const planPayment = await activatePlanPayment(
        admin,
        orderId,
        paymentId,
        paidPaise,
        'INR',
      );
      if (planPayment.matched) {
        return jsonResponse({ success: true, data: planPayment });
      }

      const proResult = await activateKavachProOrder(
        admin,
        orderId,
        paymentId,
        paidPaise,
        currency || 'INR',
      );
      if (proResult.matched) {
        return jsonResponse({ success: true, data: proResult });
      }

      const vehicleResult = await activateVehicleSubscription(
        admin,
        orderId,
        paymentId,
        paidPaise,
        currency || 'INR',
      );
      return jsonResponse({ success: true, data: vehicleResult });
    } catch (innerErr) {
      // Release event lock so Razorpay retry can re-process after transient failure.
      if (eventClaimed && eventId) {
        await admin.from('razorpay_webhook_events').delete().eq('event_id', eventId);
      }
      throw innerErr;
    }
  } catch (err) {
    console.error('razorpay-webhook', err);
    // 500 → Razorpay retries. Never leak internals.
    return jsonResponse(
      { success: false, error: 'Internal error' } satisfies ApiResponse<never>,
      500,
    );
  }
});

async function claimWebhookEvent(
  admin: SupabaseClient,
  input: {
    eventId: string;
    eventType: string | null;
    paymentId: string | null;
    orderId: string | null;
  },
): Promise<boolean> {
  const { error } = await admin.from('razorpay_webhook_events').insert({
    event_id: input.eventId,
    event_type: input.eventType,
    payment_id: input.paymentId,
    order_id: input.orderId,
    outcome: 'processing',
  });

  if (error) {
    // Unique violation → already processed / in-flight.
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }
  return true;
}

function expectedPaiseForTier(
  tier: SubscriptionTier,
  vehicleQty: number,
): number {
  const qty = Math.max(1, vehicleQty);
  if (tier === 'free') return 0;
  return PLAN_PRICE_PAISE[tier] * qty;
}

/** Exact paise match (allow ±1 paise only for floating conversion noise). */
function amountMatchesExpected(paidPaise: number, expectedPaise: number): boolean {
  if (!Number.isFinite(paidPaise) || paidPaise <= 0) return false;
  if (!Number.isFinite(expectedPaise) || expectedPaise <= 0) return false;
  // INR paise are integers — require exact match.
  return paidPaise === expectedPaise;
}

async function activatePlanPayment(
  admin: SupabaseClient,
  razorpayOrderId: string,
  paymentId: string | null,
  paidPaise: number,
  currency: string,
): Promise<{
  matched: boolean;
  kind?: 'plan_payment';
  paymentRowId?: string;
  tier?: string;
  userId?: string;
  alreadyPaid?: boolean;
  rejected?: string;
  scanCreditsBalance?: number;
}> {
  const { data: pay, error } = await admin
    .from('payments')
    .select('id, user_id, tier, status, vehicle_qty, amount_paise, currency')
    .eq('provider', 'razorpay')
    .eq('provider_order_id', razorpayOrderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!pay) return { matched: false };

  if (pay.status === 'successful') {
    return {
      matched: true,
      kind: 'plan_payment',
      paymentRowId: pay.id as string,
      tier: pay.tier as string,
      userId: pay.user_id as string,
      alreadyPaid: true,
    };
  }

  const tier = pay.tier as SubscriptionTier;
  const vehicleQty = Number(pay.vehicle_qty) || 1;
  const expected =
    Number(pay.amount_paise) > 0
      ? Number(pay.amount_paise)
      : expectedPaiseForTier(tier, vehicleQty);

  const rowCurrency = String(pay.currency ?? 'INR').toUpperCase();
  if (rowCurrency !== 'INR' || currency !== 'INR') {
    await admin
      .from('payments')
      .update({
        status: 'failed',
        provider_payment_id: paymentId,
        metadata: {
          reject_reason: 'currency_mismatch',
          paid_currency: currency,
          row_currency: rowCurrency,
        },
      })
      .eq('id', pay.id);
    return {
      matched: true,
      kind: 'plan_payment',
      paymentRowId: pay.id as string,
      tier,
      userId: pay.user_id as string,
      rejected: 'currency_mismatch',
    };
  }

  if (!amountMatchesExpected(paidPaise, expected)) {
    await admin
      .from('payments')
      .update({
        status: 'failed',
        provider_payment_id: paymentId,
        metadata: {
          reject_reason: 'amount_mismatch',
          paid_paise: paidPaise,
          expected_paise: expected,
        },
      })
      .eq('id', pay.id);

    return {
      matched: true,
      kind: 'plan_payment',
      paymentRowId: pay.id as string,
      tier,
      userId: pay.user_id as string,
      rejected: 'amount_mismatch',
    };
  }

  // mark_payment_successful is idempotent (pending/failed → successful once).
  const entitled = await markPaymentSuccessful(
    admin,
    pay.id as string,
    paymentId,
    null,
  );

  return {
    matched: true,
    kind: 'plan_payment',
    paymentRowId: pay.id as string,
    tier: entitled.tier,
    userId: pay.user_id as string,
    scanCreditsBalance: entitled.scan_credits_balance,
  };
}

async function activateKavachProOrder(
  admin: SupabaseClient,
  razorpayOrderId: string,
  paymentId: string | null,
  paidPaise: number,
  currency: string,
): Promise<{
  matched: boolean;
  kind?: 'kavach_pro';
  userId?: string;
  alreadyPaid?: boolean;
  rejected?: string;
  scanCreditsBalance?: number;
}> {
  const { data: order, error } = await admin
    .from('orders')
    .select('id, user_id, status, amount')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!order) return { matched: false };

  if (currency !== 'INR') {
    await admin
      .from('orders')
      .update({ status: 'FAILED', razorpay_payment_id: paymentId })
      .eq('id', order.id);
    return {
      matched: true,
      kind: 'kavach_pro',
      userId: order.user_id as string,
      rejected: 'currency_mismatch',
    };
  }

  const amountRupees = Number(order.amount) || PLAN_PRICE_PAISE.pro_annual / 100;
  const vehicleQty = Math.max(
    1,
    Math.round(amountRupees / (PLAN_PRICE_PAISE.pro_annual / 100)),
  );
  const expected = expectedPaiseForTier('pro_annual', vehicleQty);

  if (!amountMatchesExpected(paidPaise, expected)) {
    await admin
      .from('orders')
      .update({
        status: 'FAILED',
        razorpay_payment_id: paymentId,
      })
      .eq('id', order.id);
    return {
      matched: true,
      kind: 'kavach_pro',
      userId: order.user_id as string,
      rejected: 'amount_mismatch',
    };
  }

  // Atomic claim — concurrent payment.captured + order.paid cannot double-grant.
  const { data: claimed, error: claimErr } = await admin.rpc('claim_order_paid', {
    p_order_id: order.id,
    p_razorpay_payment_id: paymentId,
  });
  if (claimErr) throw new Error(claimErr.message);

  if (!claimed) {
    await admin.from('profiles').update({ is_pro: true }).eq('id', order.user_id);
    return {
      matched: true,
      kind: 'kavach_pro',
      userId: order.user_id as string,
      alreadyPaid: true,
    };
  }

  await activatePaidPeriod(
    admin,
    order.user_id as string,
    vehicleQty,
    razorpayOrderId,
  );

  const entitled = await grantPlanPurchase(
    admin,
    order.user_id as string,
    'pro_annual',
    null,
    vehicleQty,
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
    scanCreditsBalance: entitled.scan_credits_balance,
  };
}

async function activateVehicleSubscription(
  admin: SupabaseClient,
  orderId: string,
  paymentId: string | null,
  paidPaise: number,
  currency: string,
): Promise<Record<string, unknown>> {
  const { data: attempt, error } = await admin
    .from('payment_attempts')
    .select('id, user_id, vehicle_qty, status, kind, amount_paise, metadata')
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

  if (currency !== 'INR') {
    return { rejected: 'currency_mismatch', kind: attempt.kind };
  }

  const qty = Math.max(1, Number(attempt.vehicle_qty) || 1);
  const meta = (attempt.metadata ?? {}) as {
    expand_seats?: boolean;
    mode?: string;
    extra_seats?: number;
    previous_qty?: number;
  };
  const isExpand =
    meta.expand_seats === true || meta.mode === 'expand_seats';
  const expected =
    Number(attempt.amount_paise) > 0
      ? Number(attempt.amount_paise)
      : isExpand
        ? expectedPaiseForTier(
            'pro_annual',
            Math.max(1, Number(meta.extra_seats) || 1),
          )
        : expectedPaiseForTier('pro_annual', qty);

  if (!amountMatchesExpected(paidPaise, expected)) {
    console.error('payment_attempt amount_mismatch', {
      orderId,
      paidPaise,
      expected,
    });
    return { rejected: 'amount_mismatch', kind: attempt.kind };
  }

  const { data: claimed, error: claimErr } = await admin.rpc(
    'claim_payment_attempt_paid',
    {
      p_attempt_id: attempt.id,
      p_razorpay_payment_id: paymentId,
    },
  );
  if (claimErr) throw new Error(claimErr.message);

  if (!claimed) {
    return { alreadyPaid: true, kind: attempt.kind };
  }

  if (attempt.kind !== 'subscription') {
    return { kind: attempt.kind };
  }

  if (isExpand) {
    const expanded = await expandPaidSeats(
      admin,
      attempt.user_id as string,
      qty,
      orderId,
    );
    return {
      kind: 'subscription',
      mode: 'expand_seats',
      userId: attempt.user_id,
      periodEnd: expanded.periodEnd,
      entitled: expanded.entitled,
      vehicleQty: expanded.vehicleQty,
      previousQty: expanded.previousQty,
    };
  }

  const activated = await activatePaidPeriod(
    admin,
    attempt.user_id as string,
    qty,
    orderId,
  );

  const entitled = await grantPlanPurchase(
    admin,
    attempt.user_id as string,
    'pro_annual',
    null,
    qty,
  );

  return {
    kind: 'subscription',
    mode: 'purchase',
    userId: attempt.user_id,
    periodEnd: activated.periodEnd,
    entitled: activated.entitled,
    scanCreditsBalance: entitled.scan_credits_balance,
  };
}
