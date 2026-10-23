/**
 * delete-account — DPDP Act 2023 right to erasure (self-serve).
 *
 * Authenticates the caller JWT, purges application data, then deletes
 * auth.users via the Admin API (cascades public.profiles).
 *
 * Body: { confirm: "DELETE" }
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import {
  clientIpFromRequest,
  userAgentFromRequest,
  writeAuditLog,
} from '../_shared/security.ts';
import type { ApiResponse } from '../_shared/types.ts';


const RequestSchema = z.object({
  confirm: z.literal('DELETE'),
});

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed. Use POST.' } satisfies ApiResponse<never>,
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
          error: 'Confirmation required. Send { "confirm": "DELETE" }.',
        } satisfies ApiResponse<never>,
        400,
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'ACCOUNT_DELETE',
      ipAddress: clientIpFromRequest(req),
      userAgent: userAgentFromRequest(req),
      requestPayload: { confirm: 'DELETE' },
    });

    await eraseUserData(admin, user.id);

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) {
      console.error('auth.admin.deleteUser failed', deleteAuthError);
      return jsonResponse(
        {
          success: false,
          error: `Account data purged but auth deletion failed: ${deleteAuthError.message}`,
        } satisfies ApiResponse<never>,
        500,
      );
    }

    return jsonResponse({
      success: true,
      data: { deletedUserId: user.id },
    } satisfies ApiResponse<{ deletedUserId: string }>);
  } catch (err) {
    console.error('delete-account failed', err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Account deletion failed',
      } satisfies ApiResponse<never>,
      500,
    );
  }
});

/**
 * Order matters: child rows first where FKs do not cascade from auth.users,
 * then profile-scoped tables. vehicles cascade → challans, entitlements,
 * consent_audit_logs (by vehicle_id).
 */
async function eraseUserData(admin: SupabaseClient, userId: string): Promise<void> {
  const steps: Array<{ label: string; run: () => PromiseLike<{ error: { message: string } | null }> }> = [
    {
      label: 'consent_audit_logs',
      run: () => admin.from('consent_audit_logs').delete().eq('user_id', userId),
    },
    {
      label: 'vehicle_claim_attempts',
      run: () => admin.from('vehicle_claim_attempts').delete().eq('user_id', userId),
    },
    {
      label: 'payment_attempts',
      run: () => admin.from('payment_attempts').delete().eq('user_id', userId),
    },
    {
      label: 'vehicle_entitlements',
      run: () => admin.from('vehicle_entitlements').delete().eq('user_id', userId),
    },
    {
      label: 'vehicles',
      run: () => admin.from('vehicles').delete().eq('user_id', userId),
    },
    {
      label: 'subscriptions',
      run: () => admin.from('subscriptions').delete().eq('user_id', userId),
    },
    {
      // Clears Telegram / WhatsApp / Signal notification linkage (preferred_channel etc.)
      label: 'profiles',
      run: () => admin.from('profiles').delete().eq('id', userId),
    },
  ];

  for (const step of steps) {
    const { error } = await step.run();
    if (error) {
      throw new Error(`Failed to delete ${step.label}: ${error.message}`);
    }
  }
}
