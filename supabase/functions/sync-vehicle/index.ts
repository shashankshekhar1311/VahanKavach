/**
 * sync-vehicle — Module 2
 *
 * Ownership rules:
 *   - CLAIM (first Protect): requires chassisLast5 matching upstream RC.
 *   - REFRESH: only for vehicles already owned by the caller (forceRefresh OK).
 *   - Plate owned by another account → 409.
 * Billing (~₹1/day/vehicle):
 *   - First vehicle → trial entitlement; more vehicles need paid vehicle_qty.
 *   - Refresh requires active vehicle_entitlements row.
 *
 * Cache: entitled vehicles use BILLING_CACHE_TTL_HOURS (default 7d).
 *
 * Body:
 *   { regNumber, mode?: "claim"|"refresh", chassisLast5?: string, forceRefresh?: boolean }
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { jsonResponse, optionsResponse, rateLimitedResponse } from '../_shared/cors.ts';
import {
  challansFromDbRows,
  computeCompliance,
  isCacheFresh,
  toDateOnly,
  vehicleFromDbRow,
  type DbChallanRow,
  type DbVehicleRow,
} from '../_shared/compliance.ts';
import {
  CircuitOpenError,
  getVehicleProvider,
  ProviderHttpError,
} from '../_shared/providers/index.ts';

import type {
  ApiResponse,
  ChallanItem,
  StandardVehicleCompliance,
  SyncVehicleResponseData,
} from '../_shared/types.ts';
import { toDbChallanStatus } from '../_shared/types.ts';
import { InvalidRegistrationError } from '../_shared/utils/registration.ts';
import { entitledCacheTtlMs } from '../_shared/billing/config.ts';
import {
  assertCanClaimVehicle,
  assertVehicleEntitledForRefresh,
  grantVehicleEntitlement,
} from '../_shared/billing/entitlements.ts';
import {
  assertStrictIndianVehicleNumber,
  assertVehicleLookupRateLimit,
  clientIpFromRequest,
  RateLimitError,
  SecurityValidationError,
  userAgentFromRequest,
  writeAuditLog,
} from '../_shared/security.ts';


const RequestSchema = z.object({
  regNumber: z.string().min(1, 'regNumber is required'),
  forceRefresh: z.boolean().optional().default(false),
  mode: z.enum(['claim', 'refresh']).optional(),
  chassisLast5: z.string().optional(),
});

const MAX_CLAIM_REJECTS_PER_HOUR = 8;

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
          error:
            'Invalid JSON body. Expected { regNumber, mode?, chassisLast5?, forceRefresh? }.',
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

    const ip = clientIpFromRequest(req);
    const userAgent = userAgentFromRequest(req);
    const rate = assertVehicleLookupRateLimit(ip);

    const regNumber = assertStrictIndianVehicleNumber(parsed.data.regNumber);
    const forceRefresh = parsed.data.forceRefresh;
    const chassisSubmitted = normalizeChassisLast5(parsed.data.chassisLast5);

    const admin = createServiceClient();
    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'VEHICLE_LOOKUP',
      ipAddress: ip,
      userAgent,
      requestPayload: {
        regNumber,
        mode: parsed.data.mode ?? null,
        forceRefresh,
        rateRemaining: rate.remaining,
      },
    });

    const { data: existingAny, error: vehicleLookupError } = await admin
      .from('vehicles')
      .select(
        'id, user_id, reg_number, chassis_last_5, engine_last_5, maker_model, fuel_type, puc_expiry_date, insurance_expiry_date, fitness_expiry_date, fastag_status, fastag_bank, last_polled_at',

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
      if (chassisSubmitted) {
        await recordClaimAttempt(supabase, user.id, regNumber, chassisSubmitted, 'conflict');
      }
      return jsonResponse(
        {
          success: false,
          error:
            'This registration number is already linked to another VahanKavach account.',
        } satisfies ApiResponse<never>,
        409,
      );
    }

    const existingVehicle = (existingAny as DbVehicleRow | null) ?? null;
    const owned = Boolean(existingVehicle);

    const mode =
      parsed.data.mode ??
      (owned ? 'refresh' : 'claim');

    const cacheTtl = entitledCacheTtlMs();

    if (mode === 'refresh') {
      if (!owned || !existingVehicle) {
        return jsonResponse(
          {
            success: false,
            error:
              'Refresh is only allowed for vehicles you already own. Use Protect with chassis last 5 to claim first.',
          } satisfies ApiResponse<never>,
          403,
        );
      }

      const entitled = await assertVehicleEntitledForRefresh(admin, existingVehicle.id);
      if (!entitled.ok) {
        return jsonResponse(
          { success: false, error: entitled.message } satisfies ApiResponse<never>,
          402,
        );
      }

      if (!forceRefresh && isCacheFresh(existingVehicle.last_polled_at, cacheTtl)) {
        return await respondFromCache(supabase, existingVehicle);
      }

      return await syncFromUpstream(supabase, user.id, existingVehicle.id, regNumber);
    }

    // --- CLAIM path (first-time Protect) -----------------------------------
    if (owned) {
      const entitled = await assertVehicleEntitledForRefresh(admin, existingVehicle!.id);
      if (!entitled.ok) {
        return jsonResponse(
          { success: false, error: entitled.message } satisfies ApiResponse<never>,
          402,
        );
      }
      if (!forceRefresh && isCacheFresh(existingVehicle!.last_polled_at, cacheTtl)) {
        return await respondFromCache(supabase, existingVehicle!);
      }
      return await syncFromUpstream(supabase, user.id, existingVehicle!.id, regNumber);
    }

    if (!chassisSubmitted) {
      return jsonResponse(
        {
          success: false,
          error:
            'Ownership proof required. Enter the last 5 characters of the chassis number from your RC to claim this vehicle.',
        } satisfies ApiResponse<never>,
        403,
      );
    }

    const claimGate = await assertCanClaimVehicle(admin, user.id);
    if (!claimGate.ok) {
      return jsonResponse(
        {
          success: false,
          error: claimGate.message,
          data: { code: claimGate.code, vehicleQtyNeeded: claimGate.vehicleQtyNeeded },
        } as ApiResponse<{ code: string; vehicleQtyNeeded: number }>,
        402,
      );
    }

    const recentRejects = await countRecentRejects(supabase, user.id);
    if (recentRejects >= MAX_CLAIM_REJECTS_PER_HOUR) {
      return jsonResponse(
        {
          success: false,
          error:
            'Too many failed ownership checks. Wait up to an hour before trying again.',
        } satisfies ApiResponse<never>,
        429,
      );
    }

    const provider = getVehicleProvider();
    const upstreamVehicle = await provider.getVehicleDetails(regNumber);
    const upstreamChassis = normalizeChassisLast5(upstreamVehicle.chassisLast5);

    if (!upstreamChassis || upstreamChassis !== chassisSubmitted) {
      await recordClaimAttempt(supabase, user.id, regNumber, chassisSubmitted, 'rejected');
      return jsonResponse(
        {
          success: false,
          error:
            'Chassis last 5 does not match RC records. Check your registration certificate and try again.',
        } satisfies ApiResponse<never>,
        403,
      );
    }

    await recordClaimAttempt(supabase, user.id, regNumber, chassisSubmitted, 'verified');

    const upstreamChallans = await provider.getPendingChallans(
      regNumber,
      upstreamVehicle.chassisLast5 ?? undefined,
    );

    const normalizedVehicle: StandardVehicleCompliance = {
      ...upstreamVehicle,
      regNumber,
    };

    const vehicleRow = await upsertVehicle(
      supabase,
      user.id,
      undefined,
      normalizedVehicle,
    );
    await upsertChallans(supabase, vehicleRow.id, upstreamChallans);
    await grantVehicleEntitlement(admin, user.id, vehicleRow.id, claimGate.mode);

    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'CHALLAN_QUERY',
      ipAddress: ip,
      userAgent,
      requestPayload: {
        regNumber,
        challanCount: upstreamChallans.length,
        source: 'UPSTREAM',
      },
    });

    const payload: SyncVehicleResponseData = {
      source: 'UPSTREAM',
      vehicle: normalizedVehicle,
      challans: upstreamChallans,
      compliance: computeCompliance(normalizedVehicle, upstreamChallans),
    };

    return jsonResponse({
      success: true,
      data: payload,
    } satisfies ApiResponse<SyncVehicleResponseData>);
  } catch (err) {
    return handleError(err);
  }
});


async function respondFromCache(
  supabase: SupabaseClient,
  existingVehicle: DbVehicleRow,
): Promise<Response> {
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

  const vehicle = vehicleFromDbRow(existingVehicle);
  const challans = challansFromDbRows((cachedChallans ?? []) as DbChallanRow[]);
  const payload: SyncVehicleResponseData = {
    source: 'CACHE',
    vehicle,
    challans,
    compliance: computeCompliance(vehicle, challans),
  };

  return jsonResponse({
    success: true,
    data: payload,
  } satisfies ApiResponse<SyncVehicleResponseData>);
}

async function syncFromUpstream(
  supabase: SupabaseClient,
  userId: string,
  existingId: string | undefined,
  regNumber: string,
): Promise<Response> {
  const provider = getVehicleProvider();
  const upstreamVehicle = await provider.getVehicleDetails(regNumber);
  const upstreamChallans = await provider.getPendingChallans(
    regNumber,
    upstreamVehicle.chassisLast5 ?? undefined,
  );

  const normalizedVehicle: StandardVehicleCompliance = {
    ...upstreamVehicle,
    regNumber,
  };

  const vehicleRow = await upsertVehicle(
    supabase,
    userId,
    existingId,
    normalizedVehicle,
  );
  await upsertChallans(supabase, vehicleRow.id, upstreamChallans);

  const payload: SyncVehicleResponseData = {
    source: 'UPSTREAM',
    vehicle: normalizedVehicle,
    challans: upstreamChallans,
    compliance: computeCompliance(normalizedVehicle, upstreamChallans),
  };

  return jsonResponse({
    success: true,
    data: payload,
  } satisfies ApiResponse<SyncVehicleResponseData>);
}

function normalizeChassisLast5(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 5) return null;
  return cleaned.slice(-5);
}

async function recordClaimAttempt(
  supabase: SupabaseClient,
  userId: string,
  regNumber: string,
  chassisLast5: string,
  outcome: 'verified' | 'rejected' | 'conflict',
): Promise<void> {
  const { error } = await supabase.from('vehicle_claim_attempts').insert({
    user_id: userId,
    reg_number: regNumber,
    chassis_last_5_submitted: chassisLast5,
    outcome,
  });
  if (error) {
    console.error('vehicle_claim_attempts insert failed', error);
  }
}

async function countRecentRejects(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('vehicle_claim_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('outcome', 'rejected')
    .gte('created_at', since);

  if (error) {
    console.error('claim reject count failed', error);
    return 0;
  }
  return count ?? 0;
}

async function upsertVehicle(
  supabase: SupabaseClient,
  userId: string,
  existingId: string | undefined,
  vehicle: StandardVehicleCompliance,
): Promise<{ id: string }> {
  // Data minimization: only last-5 chassis/engine; never owner residential address.
  const row = {
    ...(existingId ? { id: existingId } : {}),
    user_id: userId,
    reg_number: vehicle.regNumber,
    chassis_last_5: normalizeChassisLast5(vehicle.chassisLast5),
    engine_last_5: normalizeChassisLast5(vehicle.engineLast5),
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
  if (err instanceof RateLimitError) {
    return rateLimitedResponse(err.message, err.retryAfterSec);
  }

  if (
    err instanceof SecurityValidationError ||
    err instanceof InvalidRegistrationError
  ) {
    return jsonResponse(
      { success: false, error: err.message } satisfies ApiResponse<never>,
      err.status,
    );
  }

  if (err instanceof CircuitOpenError) {
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

