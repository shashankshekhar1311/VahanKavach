/**
 * create-billing-checkout — annual prepaid (₹329/vehicle/year · ₹1/day framing).
 *
 * Body: { vehicleQty: number }
 * Returns Razorpay order fields, or activates immediately when BILLING_MOCK=true.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import {
  billingMockEnabled,
  billingPaisePerVehicleYear,
  listRupeesPerVehicleYear,
  rupeesPerVehicleYear,
} from '../_shared/billing/config.ts';

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
  vehicleQty: z.number().int().min(1).max(50),
});

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

    const body = await req.json().catch(() => null);
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

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'PAYMENT_ATTEMPT',
      ipAddress: clientIpFromRequest(req),
      userAgent: userAgentFromRequest(req),
      requestPayload: {
        product: 'kavach_pro_annual',
        vehicleQty: parsed.data.vehicleQty,
        mock: billingMockEnabled(),
      },
    });

    const owned = await countUserVehicles(admin, user.id);
    const vehicleQty = Math.max(parsed.data.vehicleQty, owned, 1);
    const paiseEach = billingPaisePerVehicleYear();
    const amountPaise = vehicleQty * paiseEach;


    if (billingMockEnabled()) {
      const { data: attempt, error: attErr } = await admin
        .from('payment_attempts')
        .insert({
          user_id: user.id,
          kind: 'subscription',
          amount_paise: amountPaise,
          status: 'paid',
          vehicle_qty: vehicleQty,
          metadata: { mock: true },
        })
        .select('id')
        .single();
      if (attErr) throw new Error(attErr.message);

      const activated = await activatePaidPeriod(admin, user.id, vehicleQty, null);
      return jsonResponse({
        success: true,
        data: {
          mock: true,
          attemptId: attempt.id,
          vehicleQty,
          amountPaise,
          amountRupees: amountPaise / 100,
          rupeesPerVehicle: rupeesPerVehicleYear(),
          periodEnd: activated.periodEnd,
          entitledVehicles: activated.entitled,
          message:
            'Mock annual prepaid activated (BILLING_MOCK=true) — ₹329/vehicle/year.',
        },
      });
    }


    const keyId = Deno.env.get('RAZORPAY_KEY_ID')?.trim();
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')?.trim();
    if (!keyId || !keySecret) {
      return jsonResponse(
        {
          success: false,
          error:
            'Razorpay is not configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (or BILLING_MOCK=true for local).',
        } satisfies ApiResponse<never>,
        503,
      );
    }

    const receipt = `vk_${user.id.replace(/-/g, '').slice(0, 8)}_${Date.now()}`;
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receipt.slice(0, 40),
        notes: {
          user_id: user.id,
          vehicle_qty: String(vehicleQty),
          product: 'kavach_pro_annual',
        },
      }),
    });

    const orderRaw: unknown = await orderRes.json().catch(() => null);
    if (!orderRes.ok) {
      console.error('razorpay order error', orderRes.status, orderRaw);
      return jsonResponse(
        { success: false, error: 'Failed to create Razorpay order' } satisfies ApiResponse<never>,
        502,
      );
    }

    const order = orderRaw as { id: string; amount: number; currency: string };
    const { data: attempt, error: attErr } = await admin
      .from('payment_attempts')
      .insert({
        user_id: user.id,
        kind: 'subscription',
        amount_paise: amountPaise,
        status: 'pending',
        vehicle_qty: vehicleQty,
        razorpay_order_id: order.id,
        metadata: { receipt },
      })
      .select('id')
      .single();
    if (attErr) throw new Error(attErr.message);

    return jsonResponse({
      success: true,
      data: {
        mock: false,
        attemptId: attempt.id,
        orderId: order.id,
        amountPaise: order.amount,
        currency: order.currency,
        keyId,
        vehicleQty,
        amountRupees: amountPaise / 100,
        rupeesPerVehicle: rupeesPerVehicleYear(),
        description:
          `VahanKavach — ${vehicleQty} vehicle(s) × ₹${rupeesPerVehicleYear()}/year ` +
          `(₹1/day · save 1 month vs ₹${listRupeesPerVehicleYear()})`,
      },
    });
  } catch (err) {
    console.error('create-billing-checkout', err);

    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal error',
      } satisfies ApiResponse<never>,
      500,
    );
  }
});
