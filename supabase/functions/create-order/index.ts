/**
 * create-order — Kavach Pro annual prepaid (₹329/vehicle/year · ₹1/day framing).
 *
 * Body: { vehicleQty?: number }  (defaults to max(owned, 1))
 * Auth: Bearer Supabase JWT.
 * Returns { orderId, amount, keyId, vehicleQty, ... } (amount in paise).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import {
  KAVACH_PRO_CURRENCY,
  KAVACH_PRO_PRODUCT,
  kavachProDescription,
  proAmountPaise,
  proAmountRupees,
  proMockEnabled,
} from '../_shared/billing/pro.ts';
import {
  activatePaidPeriod,
  countUserVehicles,
} from '../_shared/billing/entitlements.ts';
import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import {
  clientIpFromRequest,
  userAgentFromRequest,
  writeAuditLog,
} from '../_shared/security.ts';
import type { ApiResponse } from '../_shared/types.ts';

const RequestSchema = z.object({
  vehicleQty: z.number().int().min(1).max(50).optional(),
});

type CreateOrderData = {
  orderId: string;
  amount: number;
  keyId: string;
  currency: string;
  vehicleQty: number;
  amountRupees: number;
  mock?: boolean;
  description?: string;
  periodEnd?: string;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(
        { success: false, error: 'Unauthorized' } satisfies ApiResponse<never>,
        401,
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anon || !serviceKey) {
      return jsonResponse(
        { success: false, error: 'Server misconfiguration' } satisfies ApiResponse<never>,
        500,
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
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return jsonResponse(
        {
          success: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        } satisfies ApiResponse<never>,
        400,
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const owned = await countUserVehicles(admin, user.id);
    const vehicleQty = Math.max(parsed.data.vehicleQty ?? 0, owned, 1);
    const amountPaise = proAmountPaise(vehicleQty);
    const amountRupees = proAmountRupees(vehicleQty);
    const description = kavachProDescription(vehicleQty);

    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'PAYMENT_ATTEMPT',
      ipAddress: clientIpFromRequest(req),
      userAgent: userAgentFromRequest(req),
      requestPayload: {
        product: KAVACH_PRO_PRODUCT,
        vehicleQty,
        amountRupees,
        mock: proMockEnabled(),
      },
    });

    if (proMockEnabled()) {
      const mockOrderId = `order_mock_pro_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
      const { error: insertErr } = await admin.from('orders').insert({
        user_id: user.id,
        razorpay_order_id: mockOrderId,
        amount: amountRupees,
        currency: KAVACH_PRO_CURRENCY,
        status: 'SUCCESS',
        razorpay_payment_id: `pay_mock_${Date.now()}`,
      });
      if (insertErr) throw new Error(insertErr.message);

      const activated = await activatePaidPeriod(
        admin,
        user.id,
        vehicleQty,
        mockOrderId,
      );
      const { error: proErr } = await admin
        .from('profiles')
        .update({ is_pro: true })
        .eq('id', user.id);
      if (proErr) throw new Error(proErr.message);

      return jsonResponse({
        success: true,
        data: {
          orderId: mockOrderId,
          amount: amountPaise,
          keyId: 'mock',
          currency: KAVACH_PRO_CURRENCY,
          vehicleQty,
          amountRupees,
          mock: true,
          description,
          periodEnd: activated.periodEnd,
        } satisfies CreateOrderData,
      } satisfies ApiResponse<CreateOrderData>);
    }

    const keyId = Deno.env.get('RAZORPAY_KEY_ID')?.trim();
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')?.trim();
    if (!keyId || !keySecret) {
      return jsonResponse(
        {
          success: false,
          error:
            'Razorpay is not configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (or BILLING_MOCK=true).',
        } satisfies ApiResponse<never>,
        503,
      );
    }

    const receipt = `pro_${user.id.replace(/-/g, '').slice(0, 8)}_${Date.now()}`;
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: KAVACH_PRO_CURRENCY,
        receipt: receipt.slice(0, 40),
        notes: {
          user_id: user.id,
          product: KAVACH_PRO_PRODUCT,
          vehicle_qty: String(vehicleQty),
        },
      }),
    });

    const orderRaw: unknown = await orderRes.json().catch(() => null);
    if (!orderRes.ok) {
      console.error('razorpay create-order error', orderRes.status, orderRaw);
      return jsonResponse(
        { success: false, error: 'Failed to create Razorpay order' } satisfies ApiResponse<never>,
        502,
      );
    }

    const order = orderRaw as { id: string; amount: number; currency: string };
    const { error: insertErr } = await admin.from('orders').insert({
      user_id: user.id,
      razorpay_order_id: order.id,
      amount: amountRupees,
      currency: order.currency || KAVACH_PRO_CURRENCY,
      status: 'PENDING',
    });
    if (insertErr) throw new Error(insertErr.message);

    return jsonResponse({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        keyId,
        currency: order.currency || KAVACH_PRO_CURRENCY,
        vehicleQty,
        amountRupees,
        description,
      } satisfies CreateOrderData,
    } satisfies ApiResponse<CreateOrderData>);
  } catch (err) {
    console.error('create-order', err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal error',
      } satisfies ApiResponse<never>,
      500,
    );
  }
});
