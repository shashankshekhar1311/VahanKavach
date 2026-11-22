/**
 * verify-order — client-side Razorpay Checkout payment verification for Kavach Pro.
 *
 * Body: { orderId, paymentId, signature }
 * Validates HMAC(orderId|paymentId, RAZORPAY_KEY_SECRET), claims order once,
 * activates Pro only on first successful claim (no replay extend).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { ANNUAL_PREPAID_RUPEES_PER_VEHICLE } from '../_shared/billing/config.ts';
import { activatePaidPeriod } from '../_shared/billing/entitlements.ts';
import { markPaymentSuccessful } from '../_shared/billing/plans.ts';
import { verifyCheckoutPaymentSignature } from '../_shared/billing/razorpay.ts';
import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import type { ApiResponse } from '../_shared/types.ts';

const RequestSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().min(1),
});

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return optionsResponse(req);
  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed' } satisfies ApiResponse<never>,
      405,
      {},
      req,
    );
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(
        { success: false, error: 'Unauthorized' } satisfies ApiResponse<never>,
        401,
        {},
        req,
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')?.trim();
    if (!supabaseUrl || !anon || !serviceKey) {
      return jsonResponse(
        { success: false, error: 'Server misconfiguration' } satisfies ApiResponse<never>,
        500,
        {},
        req,
      );
    }

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse(
        { success: false, error: 'Unauthorized' } satisfies ApiResponse<never>,
        401,
        {},
        req,
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(
        {
          success: false,
          error: 'Expected { orderId, paymentId, signature }',
        } satisfies ApiResponse<never>,
        400,
        {},
        req,
      );
    }

    const { orderId, paymentId, signature } = parsed.data;

    if (!keySecret) {
      return jsonResponse(
        { success: false, error: 'Payment verification unavailable' } satisfies ApiResponse<never>,
        503,
        {},
        req,
      );
    }

    const ok = await verifyCheckoutPaymentSignature(
      orderId,
      paymentId,
      signature,
      keySecret,
    );
    if (!ok) {
      return jsonResponse(
        { success: false, error: 'Invalid payment signature' } satisfies ApiResponse<never>,
        400,
        {},
        req,
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: order, error: lookupErr } = await admin
      .from('orders')
      .select('id, user_id, status, amount')
      .eq('razorpay_order_id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (lookupErr) throw new Error(lookupErr.message);
    if (!order) {
      return jsonResponse(
        { success: false, error: 'Order not found' } satisfies ApiResponse<never>,
        404,
        {},
        req,
      );
    }

    const amountRupees = Number(order.amount) || ANNUAL_PREPAID_RUPEES_PER_VEHICLE;
    const vehicleQty = Math.max(
      1,
      Math.round(amountRupees / ANNUAL_PREPAID_RUPEES_PER_VEHICLE),
    );

    // Atomic claim: only first SUCCESS transition activates entitlements.
    const { data: claimed, error: claimErr } = await admin.rpc('claim_order_paid', {
      p_order_id: order.id,
      p_razorpay_payment_id: paymentId,
    });

    if (claimErr) {
      const { data: updRows, error: updErr } = await admin
        .from('orders')
        .update({
          status: 'SUCCESS',
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
        })
        .eq('id', order.id)
        .neq('status', 'SUCCESS')
        .select('id');
      if (updErr) throw new Error(updErr.message);
      if (!updRows || updRows.length === 0) {
        return jsonResponse({
          success: true,
          data: {
            isPro: true,
            orderId,
            paymentId,
            vehicleQty,
            alreadyPaid: true,
          },
        }, 200, {}, req);
      }
    } else if (!claimed) {
      return jsonResponse({
        success: true,
        data: {
          isPro: true,
          orderId,
          paymentId,
          vehicleQty,
          alreadyPaid: true,
        },
      }, 200, {}, req);
    } else {
      await admin
        .from('orders')
        .update({ razorpay_signature: signature })
        .eq('id', order.id);
    }

    const activated = await activatePaidPeriod(
      admin,
      user.id,
      vehicleQty,
      orderId,
    );

    const { data: planPay } = await admin
      .from('payments')
      .select('id')
      .eq('provider', 'razorpay')
      .eq('provider_order_id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (planPay?.id) {
      await markPaymentSuccessful(
        admin,
        planPay.id as string,
        paymentId,
        signature,
      );
    }

    await admin.from('profiles').update({ is_pro: true }).eq('id', user.id);

    return jsonResponse({
      success: true,
      data: {
        isPro: true,
        orderId,
        paymentId,
        vehicleQty,
        periodEnd: activated.periodEnd,
        alreadyPaid: false,
      },
    }, 200, {}, req);
  } catch (err) {
    console.error('verify-order', err);
    return jsonResponse(
      { success: false, error: 'Internal error' } satisfies ApiResponse<never>,
      500,
      {},
      req,
    );
  }
});
