/**
 * record-challan-payment — audit challan pay redirect (Parivahan / UPI).
 * Does not collect money; marks attempt as redirected and optional paid_externally.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import type { ApiResponse } from '../_shared/types.ts';

const RequestSchema = z.object({
  challanId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  portalUrl: z.string().url().optional(),
  markPaidExternally: z.boolean().optional().default(false),
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
    if (!supabaseUrl || !anon) {
      return jsonResponse(
        { success: false, error: 'Server misconfiguration' } satisfies ApiResponse<never>,
        500,
      );
    }

    const supabase = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonResponse(
        { success: false, error: 'Unauthorized' } satisfies ApiResponse<never>,
        401,
      );
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return jsonResponse(
        {
          success: false,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        } satisfies ApiResponse<never>,
        400,
      );
    }

    const { challanId, vehicleId, portalUrl, markPaidExternally } = parsed.data;
    const defaultPortal =
      Deno.env.get('PAYMENT_PORTAL_URL')?.trim() ||
      'https://echallan.parivahan.gov.in/';

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, user_id')
      .eq('id', vehicleId)
      .maybeSingle();

    if (!vehicle || vehicle.user_id !== user.id) {
      return jsonResponse(
        { success: false, error: 'Vehicle not found' } satisfies ApiResponse<never>,
        404,
      );
    }

    const { data: challan } = await supabase
      .from('challans')
      .select('id, amount, status, vehicle_id')
      .eq('id', challanId)
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (!challan) {
      return jsonResponse(
        { success: false, error: 'Challan not found' } satisfies ApiResponse<never>,
        404,
      );
    }

    const amountPaise = Math.round(Number(challan.amount) * 100);
    const { data: attempt, error } = await supabase
      .from('payment_attempts')
      .insert({
        user_id: user.id,
        vehicle_id: vehicleId,
        challan_id: challanId,
        kind: 'challan',
        amount_paise: amountPaise,
        status: markPaidExternally ? 'paid' : 'redirected',
        portal_url: portalUrl ?? defaultPortal,
      })
      .select('id, portal_url, status')
      .single();

    if (error) throw new Error(error.message);

    if (markPaidExternally) {
      await supabase
        .from('challans')
        .update({ status: 'PAID_EXTERNALLY' })
        .eq('id', challanId);
    }

    return jsonResponse({
      success: true,
      data: {
        attemptId: attempt.id,
        portalUrl: attempt.portal_url ?? defaultPortal,
        status: attempt.status,
      },
    });
  } catch (err) {
    console.error('record-challan-payment', err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal error',
      } satisfies ApiResponse<never>,
      500,
    );
  }
});
