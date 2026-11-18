/**
 * create-billing-checkout — Kavach Pro annual prepaid.
 *
 * Body: {
 *   vehicleQty: number
 *   mode?: 'purchase' | 'expand_seats'   // default purchase
 * }
 *
 * purchase     — full ₹399 × vehicleQty, starts/renews annual window
 * expand_seats — ₹399 × extra seats only, keeps current_period_end
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
  expandPaidSeats,
  getSubscription,
  isEntitlementActive,
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
  mode: z.enum(['purchase', 'expand_seats']).optional(),
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

    const owned = await countUserVehicles(admin, user.id);
    const sub = await getSubscription(admin, user.id);
    const currentQty = Math.max(0, sub?.vehicle_qty ?? 0);
    const periodEnd = sub?.current_period_end ?? sub?.trial_ends_at ?? null;
    const periodOk =
      Boolean(periodEnd) &&
      isEntitlementActive(periodEnd) &&
      Boolean(sub) &&
      (sub!.status === 'active' ||
        sub!.status === 'trial' ||
        sub!.status === 'past_due');

    const requestedMode = parsed.data.mode ?? 'purchase';
    const canExpand =
      requestedMode === 'expand_seats' && periodOk && currentQty > 0;
    const mode = canExpand ? 'expand_seats' : 'purchase';

    const vehicleQty =
      mode === 'expand_seats'
        ? Math.max(parsed.data.vehicleQty, owned, currentQty + 1, 1)
        : Math.max(parsed.data.vehicleQty, owned, 1);

    const paiseEach = billingPaisePerVehicleYear();
    const extraSeats =
      mode === 'expand_seats' ? Math.max(1, vehicleQty - currentQty) : vehicleQty;
    const amountPaise = extraSeats * paiseEach;
    const amountRupees = amountPaise / 100;

    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'PAYMENT_ATTEMPT',
      ipAddress: clientIpFromRequest(req),
      userAgent: userAgentFromRequest(req),
      requestPayload: {
        product: 'kavach_pro_annual',
        mode,
        vehicleQty,
        currentQty,
        extraSeats,
        mock: billingMockEnabled(),
      },
    });

    if (billingMockEnabled()) {
      const { data: attempt, error: attErr } = await admin
        .from('payment_attempts')
        .insert({
          user_id: user.id,
          kind: 'subscription',
          amount_paise: amountPaise,
          status: 'paid',
          vehicle_qty: vehicleQty,
          metadata: {
            mock: true,
            mode,
            previous_qty: currentQty,
            extra_seats: extraSeats,
            expand_seats: mode === 'expand_seats',
          },
        })
        .select('id')
        .single();
      if (attErr) throw new Error(attErr.message);

      const activated =
        mode === 'expand_seats'
          ? await expandPaidSeats(admin, user.id, vehicleQty, null)
          : {
              ...(await activatePaidPeriod(admin, user.id, vehicleQty, null)),
              previousQty: currentQty,
              vehicleQty,
              expanded: false,
            };

      return jsonResponse({
        success: true,
        data: {
          mock: true,
          attemptId: attempt.id,
          mode,
          vehicleQty: activated.vehicleQty ?? vehicleQty,
          previousQty: currentQty,
          extraSeats,
          amountPaise,
          amountRupees,
          rupeesPerVehicle: rupeesPerVehicleYear(),
          periodEnd: activated.periodEnd,
          entitledVehicles: activated.entitled,
          message:
            mode === 'expand_seats'
              ? `Mock Pro seat expand: +${extraSeats} seat(s) to ${vehicleQty} (same period).`
              : 'Mock annual prepaid activated (BILLING_MOCK=true) — ₹399/vehicle/year.',
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
    const description =
      mode === 'expand_seats'
        ? `VahanKavach Pro — add ${extraSeats} seat(s) (₹${rupeesPerVehicleYear()} each) · cover ${vehicleQty}`
        : `VahanKavach — ${vehicleQty} vehicle(s) × ₹${rupeesPerVehicleYear()}/year ` +
          `(challan every 10 days; vs ~₹${listRupeesPerVehicleYear()} à la carte)`;

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
          mode,
          extra_seats: String(extraSeats),
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
        metadata: {
          receipt,
          mode,
          previous_qty: currentQty,
          extra_seats: extraSeats,
          expand_seats: mode === 'expand_seats',
        },
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
        mode,
        vehicleQty,
        previousQty: currentQty,
        extraSeats,
        amountRupees,
        rupeesPerVehicle: rupeesPerVehicleYear(),
        description,
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
