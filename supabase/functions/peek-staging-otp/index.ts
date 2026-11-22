/**
 * peek-staging-otp — staging-only helper to read mirrored SMS OTP.
 * Body: { phone: "+91..." | "9876543210" }
 *
 * Hard requirements:
 *   - ENVIRONMENT === "staging"
 *   - Header x-staging-otp-secret must match STAGING_OTP_PEEK_SECRET
 *   - Valid Bearer JWT (authenticated user)
 * Never deploy/enable on production.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import type { ApiResponse } from '../_shared/types.ts';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

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

  const envName = (Deno.env.get('ENVIRONMENT') ?? '').toLowerCase();
  if (envName !== 'staging') {
    return jsonResponse(
      { success: false, error: 'Not found' } satisfies ApiResponse<never>,
      404,
      {},
      req,
    );
  }

  const expectedSecret = Deno.env.get('STAGING_OTP_PEEK_SECRET')?.trim() ?? '';
  const providedSecret = req.headers.get('x-staging-otp-secret')?.trim() ?? '';
  if (!expectedSecret || !timingSafeEqual(expectedSecret, providedSecret)) {
    return jsonResponse(
      { success: false, error: 'Forbidden' } satisfies ApiResponse<never>,
      403,
      {},
      req,
    );
  }

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

  const body = (await req.json().catch(() => null)) as { phone?: string } | null;
  let phone = (body?.phone ?? '').replace(/\D/g, '');
  if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
  if (phone.length !== 10) {
    return jsonResponse(
      { success: false, error: 'Invalid phone' } satisfies ApiResponse<never>,
      400,
      {},
      req,
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
    console.error('peek-staging-otp', error.message);
    return jsonResponse(
      { success: false, error: 'Lookup failed' } satisfies ApiResponse<never>,
      500,
      {},
      req,
    );
  }
  if (!data?.otp) {
    return jsonResponse(
      { success: false, error: 'No staging OTP found for this number yet' } satisfies ApiResponse<never>,
      404,
      {},
      req,
    );
  }

  const ageMs = Date.now() - new Date(data.created_at as string).getTime();
  if (ageMs > 10 * 60 * 1000) {
    return jsonResponse(
      { success: false, error: 'Staging OTP expired' } satisfies ApiResponse<never>,
      410,
      {},
      req,
    );
  }

  return jsonResponse({
    success: true,
    data: { otp: data.otp as string, staging: true },
  }, 200, {}, req);
});
