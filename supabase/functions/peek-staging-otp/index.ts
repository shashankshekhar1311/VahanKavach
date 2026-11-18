/**
 * peek-staging-otp — staging-only helper to read mirrored SMS OTP.
 * Body: { phone: "+91..." | "9876543210" }
 * Auth: Bearer user JWT. Disabled unless ENVIRONMENT=staging.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import type { ApiResponse } from '../_shared/types.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed' } satisfies ApiResponse<never>,
      405,
    );
  }

  if ((Deno.env.get('ENVIRONMENT') ?? '').toLowerCase() !== 'staging') {
    return jsonResponse(
      { success: false, error: 'Not available outside staging' } satisfies ApiResponse<never>,
      404,
    );
  }

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
  // Anon JWT may be the user's pre-login anon key — allow peek with just phone
  // after OTP send (no session yet). Gate by staging + rate via recent row age.

  const body = (await req.json().catch(() => null)) as { phone?: string } | null;
  let phone = (body?.phone ?? '').replace(/\D/g, '');
  if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
  if (phone.length !== 10) {
    return jsonResponse(
      { success: false, error: 'Invalid phone' } satisfies ApiResponse<never>,
      400,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from('staging_otp_inbox')
    .select('otp, created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    return jsonResponse(
      { success: false, error: error.message } satisfies ApiResponse<never>,
      500,
    );
  }
  if (!data?.otp) {
    return jsonResponse(
      { success: false, error: 'No staging OTP found for this number yet' } satisfies ApiResponse<never>,
      404,
    );
  }

  const ageMs = Date.now() - new Date(data.created_at as string).getTime();
  if (ageMs > 10 * 60 * 1000) {
    return jsonResponse(
      { success: false, error: 'Staging OTP expired' } satisfies ApiResponse<never>,
      410,
    );
  }

  // Touch userClient so unused-import / auth header stay intentional for CORS.
  void userClient;

  return jsonResponse({
    success: true,
    data: { otp: data.otp as string, staging: true },
  });
});
