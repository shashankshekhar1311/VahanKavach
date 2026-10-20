/**
 * sync-vehicle — Module 2
 *
 * Fetches RC / PUC / insurance / e-challan data from the configured provider,
 * upserts into public.vehicles + public.challans, and returns compliance flags.
 *
 * Cache: if the caller's vehicle was polled within 6 hours and forceRefresh
 * is false, returns DB values without calling the upstream provider.
 *
 * ---------------------------------------------------------------------------
 * curl examples (local Supabase: API http://127.0.0.1:54321)
 * ---------------------------------------------------------------------------
 *
 * # 1) Sign in (seed user from seed.sql)
 * curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
 *   -H 'apikey: <SUPABASE_ANON_KEY>' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"email":"aarav.mehta@vahankavach.test","password":"TestPassword123!"}'
 *
 * # 2) Sync with cache hit (KA01AB1234 polled ~2h ago in seed)
 * curl -s -X POST 'http://127.0.0.1:54321/functions/v1/sync-vehicle' \
 *   -H 'Authorization: Bearer <ACCESS_TOKEN>' \
 *   -H 'apikey: <SUPABASE_ANON_KEY>' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"regNumber":"KA-01 AB 1234"}'
 *
 * # 3) Force upstream refresh (mock provider when USE_MOCK_PROVIDER=true)
 * curl -s -X POST 'http://127.0.0.1:54321/functions/v1/sync-vehicle' \
 *   -H 'Authorization: Bearer <ACCESS_TOKEN>' \
 *   -H 'apikey: <SUPABASE_ANON_KEY>' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"regNumber":"MH12CD5678","forceRefresh":true}'
 *
 * # 4) Malformed registration → 400
 * curl -s -X POST 'http://127.0.0.1:54321/functions/v1/sync-vehicle' \
 *   -H 'Authorization: Bearer <ACCESS_TOKEN>' \
 *   -H 'apikey: <SUPABASE_ANON_KEY>' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"regNumber":"INVALID"}'
 *
 * # 5) Missing JWT → 401
 * curl -s -X POST 'http://127.0.0.1:54321/functions/v1/sync-vehicle' \
 *   -H 'apikey: <SUPABASE_ANON_KEY>' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"regNumber":"KA01AB1234"}'
 *
 * Expected success shape:
 * {
 *   "success": true,
 *   "data": {
 *     "source": "CACHE" | "UPSTREAM",
 *     "vehicle": { ...StandardVehicleCompliance },
 *     "challans": [ ...ChallanItem ],
 *     "compliance": {
 *       "isPucExpired": false,
 *       "isInsuranceExpired": false,
 *       "isFitnessExpired": false,
 *       "pendingChallanCount": 2,
 *       "totalChallanAmount": 2500
 *     }
 *   }
 * }
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import {
  challansFromDbRows,
  computeCompliance,
  isCacheFresh,
  toDateOnly,
  vehicleFromDbRow,
  type DbChallanRow,
  type DbVehicleRow,
} from '../_shared/compliance.ts';
import { createVehicleDataProvider, ProviderHttpError } from '../_shared/providers/index.ts';
import type {
  ApiResponse,
  ChallanItem,
  StandardVehicleCompliance,
  SyncVehicleResponseData,
} from '../_shared/types.ts';
import { toDbChallanStatus } from '../_shared/types.ts';
import {
  InvalidRegistrationError,
  sanitizeRegNumber,
} from '../_shared/utils/registration.ts';

const RequestSchema = z.object({
  regNumber: z.string().min(1, 'regNumber is required'),
  forceRefresh: z.boolean().optional().default(false),
});

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }

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
        {
          success: false,
          error: 'Missing or invalid Authorization header. Expected Bearer <JWT>.',
        } satisfies ApiResponse<never>,
        401,
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        {
          success: false,
          error: 'Server misconfiguration: SUPABASE_URL / SUPABASE_ANON_KEY missing.',
        } satisfies ApiResponse<never>,
        500,
      );
    }

    // User-scoped client so RLS enforces tenant isolation via auth.uid().
    const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse(
        {
          success: false,
          error: 'Unauthorized. Provide a valid Supabase Auth JWT.',
        } satisfies ApiResponse<never>,
        401,
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: 'Invalid JSON body. Expected { regNumber: string, forceRefresh?: boolean }.',
        } satisfies ApiResponse<never>,
        400,
      );
    }

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

    const regNumber = sanitizeRegNumber(parsed.data.regNumber);
    const forceRefresh = parsed.data.forceRefresh;

    // --- Cache path --------------------------------------------------------
    // Service-role lookup for ownership conflicts (RLS hides other users' rows).
    const admin = createServiceClient();
    const { data: existingAny, error: vehicleLookupError } = await admin
      .from('vehicles')
      .select(
        'id, user_id, reg_number, chassis_last_5, maker_model, fuel_type, puc_expiry_date, insurance_expiry_date, fitness_expiry_date, fastag_status, fastag_bank, last_polled_at',
      )
      .eq('reg_number', regNumber)
      .maybeSingle();

    if (vehicleLookupError) {
      console.error('vehicles lookup failed', vehicleLookupError);
      return jsonResponse(
        { success: false, error: 'Failed to query vehicles.' } satisfies ApiResponse<never>,
        500,
      );
    }

    if (existingAny && existingAny.user_id !== user.id) {
      return jsonResponse(
        {
          success: false,
          error:
            'This registration number is already linked to another VahanKavach account.',
        } satisfies ApiResponse<never>,
        409,
      );
    }

    const existingVehicle = existingAny as DbVehicleRow | null;

    if (
      existingVehicle &&
      !forceRefresh &&
      isCacheFresh((existingVehicle as DbVehicleRow).last_polled_at)
    ) {
      const { data: cachedChallans, error: challanLookupError } = await supabase
        .from('challans')
        .select(
          'challan_number, amount, violation_date, violation_type, location, evidence_url, status',
        )
        .eq('vehicle_id', existingVehicle.id);

      if (challanLookupError) {
        console.error('challans lookup failed', challanLookupError);
        return jsonResponse(
          { success: false, error: 'Failed to query challans.' } satisfies ApiResponse<never>,
          500,
        );
      }

      const vehicle = vehicleFromDbRow(existingVehicle as DbVehicleRow);
      const challans = challansFromDbRows((cachedChallans ?? []) as DbChallanRow[]);
      const payload: SyncVehicleResponseData = {
        source: 'CACHE',
        vehicle,
        challans,
        compliance: computeCompliance(vehicle, challans),
      };

      return jsonResponse({ success: true, data: payload } satisfies ApiResponse<SyncVehicleResponseData>);
    }

    // --- Upstream path -----------------------------------------------------
    const provider = createVehicleDataProvider();
    const upstreamVehicle = await provider.getVehicleDetails(regNumber);
    const upstreamChallans = await provider.getPendingChallans(
      regNumber,
      upstreamVehicle.chassisLast5,
    );

    // Prefer the sanitized plate we validated, not a messy upstream variant.
    const normalizedVehicle: StandardVehicleCompliance = {
      ...upstreamVehicle,
      regNumber,
    };

    const vehicleRow = await upsertVehicle(
      supabase,
      user.id,
      existingVehicle?.id,
      normalizedVehicle,
    );
    await upsertChallans(supabase, vehicleRow.id, upstreamChallans);

    const payload: SyncVehicleResponseData = {
      source: 'UPSTREAM',
      vehicle: normalizedVehicle,
      challans: upstreamChallans,
      compliance: computeCompliance(normalizedVehicle, upstreamChallans),
    };

    return jsonResponse({ success: true, data: payload } satisfies ApiResponse<SyncVehicleResponseData>);
  } catch (err) {
    return handleError(err);
  }
});

async function upsertVehicle(
  supabase: SupabaseClient,
  userId: string,
  existingId: string | undefined,
  vehicle: StandardVehicleCompliance,
): Promise<{ id: string }> {
  const row = {
    ...(existingId ? { id: existingId } : {}),
    user_id: userId,
    reg_number: vehicle.regNumber,
    chassis_last_5: vehicle.chassisLast5 ?? null,
    maker_model: vehicle.makerModel || null,
    fuel_type: vehicle.fuelType,
    puc_expiry_date: toDateOnly(vehicle.puc.validUpto),
    insurance_expiry_date: toDateOnly(vehicle.insurance.validUpto),
    fitness_expiry_date: toDateOnly(vehicle.fitness.validUpto),
    fastag_status: vehicle.fastagStatus ?? null,
    fastag_bank: vehicle.fastagBank ?? null,
    last_polled_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('vehicles')
    .upsert(row, { onConflict: 'reg_number' })
    .select('id')
    .single();

  if (error || !data) {
    console.error('vehicles upsert failed', error);
    // Unique reg_number owned by another user surfaces as RLS / conflict.
    throw new HttpAppError(
      error?.code === '23505'
        ? 'This registration number is already linked to another account.'
        : `Failed to upsert vehicle: ${error?.message ?? 'unknown error'}`,
      error?.code === '23505' ? 409 : 500,
    );
  }

  return data as { id: string };
}

async function upsertChallans(
  supabase: SupabaseClient,
  vehicleId: string,
  challans: ChallanItem[],
): Promise<void> {
  if (challans.length === 0) return;

  const rows = challans.map((c) => ({
    vehicle_id: vehicleId,
    challan_number: c.challanNumber,
    amount: c.amount,
    violation_date: c.violationDate,
    violation_type: c.violationType,
    location: c.location,
    evidence_url: c.evidenceUrl ?? null,
    status: toDbChallanStatus(c.status),
  }));

  const { error } = await supabase
    .from('challans')
    .upsert(rows, { onConflict: 'challan_number' });

  if (error) {
    console.error('challans upsert failed', error);
    throw new HttpAppError(`Failed to upsert challans: ${error.message}`, 500);
  }
}

class HttpAppError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpAppError';
    this.status = status;
  }
}

function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new HttpAppError(
      'Server misconfiguration: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing.',
      500,
    );
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function handleError(err: unknown): Response {
  if (err instanceof InvalidRegistrationError) {
    return jsonResponse(
      { success: false, error: err.message } satisfies ApiResponse<never>,
      err.status,
    );
  }

  if (err instanceof ProviderHttpError) {
    return jsonResponse(
      { success: false, error: err.message } satisfies ApiResponse<never>,
      err.status,
    );
  }

  if (err instanceof HttpAppError) {
    return jsonResponse(
      { success: false, error: err.message } satisfies ApiResponse<never>,
      err.status,
    );
  }

  console.error('sync-vehicle unhandled error', err);
  return jsonResponse(
    {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    } satisfies ApiResponse<never>,
    500,
  );
}
