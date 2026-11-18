/**
 * sync-vehicle — hardened Module 2
 *
 * Security:
 *   - Bearer JWT required (no anonymous lookups).
 *   - Strict Indian plate sanitization.
 *   - 30-day cached_until reuse (protects upstream API balance).
 *   - Daily paid-lookup quota via public.check_user_lookup_quota.
 *   - In-memory scrubber: never persist/log addresses, phones, full chassis, raw vendor JSON.
 *   - Zero-knowledge ownership: chassis last-5 match → is_verified_owner.
 *   - Typo wallet-protection: always cache vehicle on RC hit, even if chassis verification fails.
 *   - Fair billing: deduct live sync credit ONLY after upstream returns valid data.
 *
 * Ownership / billing:
 *   - CLAIM: chassisLast5 required + entitlement gate.
 *   - REFRESH: owned + entitled vehicle only.
 *   - Plate owned by another verified account → 409.
 *
 * Body (camelCase or snake_case):
 *   { regNumber|reg_number, mode?, chassisLast5|chassis_last5?, forceRefresh? }
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

import { jsonResponse, optionsResponse, rateLimitedResponse } from '../_shared/cors.ts';
import {
  challansFromDbRows,
  computeCompliance,
  toDateOnly,
  vehicleFromDbRow,
  type DbChallanRow,
  type DbVehicleRow,
} from '../_shared/compliance.ts';
import {
  CircuitOpenError,
  createVehicleDataProvider,
  ProviderHttpError,
} from '../_shared/providers/index.ts';
import { linkedContactCompliance } from '../_shared/providers/contact-compliance.ts';
import {
  isCachedUntilFresh,
  normalizeChassisLast5,
  scrubVehicleCompliance,
  toClientVehicle,
  vehicleCacheUntilIso,
} from '../_shared/vehicle-sanitize.ts';

import type {
  ApiResponse,
  ChallanItem,
  StandardVehicleCompliance,
  SyncVehicleResponseData,
} from '../_shared/types.ts';
import { toDbChallanStatus } from '../_shared/types.ts';
import { InvalidRegistrationError } from '../_shared/utils/registration.ts';
import {
  assertCanClaimVehicle,
  assertVehicleEntitledForRefresh,
  grantVehicleEntitlement,
} from '../_shared/billing/entitlements.ts';
import {
  assertAndConsumeLiveSync,
  LiveSyncEntitlementError,
} from '../_shared/billing/plans.ts';
import {
  assertStrictIndianVehicleNumber,
  assertUserLookupQuota,
  assertVehicleLookupRateLimit,
  clientIpFromRequest,
  dailyLookupQuotaForPro,
  DEFAULT_DAILY_LOOKUP_QUOTA,
  RateLimitError,
  SecurityValidationError,
  userAgentFromRequest,
  writeAuditLog,
} from '../_shared/security.ts';
import { notificationDispatcher } from '../_shared/notifications/dispatcher.ts';

const RequestSchema = z
  .object({
    regNumber: z.string().optional(),
    reg_number: z.string().optional(),
    forceRefresh: z.boolean().optional().default(false),
    mode: z.enum(['claim', 'refresh']).optional(),
    chassisLast5: z.string().optional(),
    chassis_last5: z.string().optional(),
  })
  .refine((d) => Boolean(d.regNumber?.trim() || d.reg_number?.trim()), {
    message: 'regNumber is required',
  });

const MAX_CLAIM_REJECTS_PER_HOUR = 8;

const VEHICLE_SELECT =
  'id, user_id, reg_number, chassis_last_5, engine_last_5, maker_model, fuel_type, puc_expiry_date, insurance_expiry_date, fitness_expiry_date, fastag_status, fastag_bank, last_polled_at, cached_until, is_verified_owner, rc_mobile_linked, rc_aadhaar_linked, rc_contact_warning';

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
            'Invalid JSON body. Expected { regNumber|reg_number, chassisLast5|chassis_last5?, forceRefresh? }.',
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

    const rawReg = parsed.data.regNumber ?? parsed.data.reg_number ?? '';
    const regNumber = assertStrictIndianVehicleNumber(rawReg);
    const forceRefreshRequested = parsed.data.forceRefresh;
    const chassisSubmitted = assertOptionalChassisLast5(
      parsed.data.chassisLast5 ?? parsed.data.chassis_last5,
    );

    const admin = createServiceClient();
    await writeAuditLog(admin, {
      userId: user.id,
      eventType: 'VEHICLE_LOOKUP',
      ipAddress: ip,
      userAgent,
      requestPayload: {
        regNumber,
        mode: parsed.data.mode ?? null,
        forceRefreshRequested,
        rateRemaining: rate.remaining,
        hasChassisProof: Boolean(chassisSubmitted),
      },
    });

    const { data: existingAny, error: vehicleLookupError } = await admin
      .from('vehicles')
      .select(VEHICLE_SELECT)
      .eq('reg_number', regNumber)
      .maybeSingle();

    if (vehicleLookupError) {
      console.error('vehicles lookup failed', vehicleLookupError.message);
      return jsonResponse(
        { success: false, error: 'Failed to query vehicles.' } satisfies ApiResponse<never>,
        500,
      );
    }

    const existingVehicle = (existingAny as DbVehicleRow | null) ?? null;

    // Plate already attached to another account — never serve or re-claim.
    if (existingVehicle?.user_id && existingVehicle.user_id !== user.id) {
      if (chassisSubmitted) {
        await recordClaimAttempt(admin, user.id, regNumber, chassisSubmitted, 'conflict');
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

    const ownedByCaller =
      Boolean(existingVehicle?.user_id) && existingVehicle?.user_id === user.id;

    // --- Hard 30-day cache (forceRefresh cannot bypass; protects API balance) -----
    if (existingVehicle && isCachedUntilFresh(existingVehicle.cached_until)) {
      await recordVehicleLookup(admin, user.id, regNumber, true);

      if (chassisSubmitted) {
        const stored = normalizeChassisLast5(existingVehicle.chassis_last_5);
        if (stored && stored === chassisSubmitted) {
          if (!ownedByCaller) {
            await attachVerifiedOwner(
              admin,
              existingVehicle.id,
              user.id,
              chassisSubmitted,
            );
            existingVehicle.user_id = user.id;
            existingVehicle.is_verified_owner = true;
            existingVehicle.chassis_last_5 = chassisSubmitted;
          }
        } else if (!ownedByCaller) {
          await recordClaimAttempt(
            admin,
            user.id,
            regNumber,
            chassisSubmitted,
            'rejected',
          );
          return jsonResponse(
            {
              success: false,
              error:
                'Chassis last 5 does not match RC records. Check your registration certificate and try again.',
            } satisfies ApiResponse<never>,
            403,
          );
        }
      } else if (!ownedByCaller) {
        return jsonResponse(
          {
            success: false,
            error:
              'Ownership proof required. Enter the last 5 characters of the chassis number from your RC.',
          } satisfies ApiResponse<never>,
          403,
        );
      }

      return await respondFromCache(admin, existingVehicle);
    }

    const mode =
      parsed.data.mode ??
      (ownedByCaller ? 'refresh' : 'claim');

    // --- REFRESH path (owned vehicles only) -----------------------------------
    if (mode === 'refresh') {
      if (!ownedByCaller || !existingVehicle) {
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

      await enforceDailyQuota(admin, user.id);
      return await syncFromUpstream(admin, user.id, existingVehicle.id, regNumber, {
        chassisSubmitted,
        attachOwner: true,
        verifiedOwner: true,
      }, ip, userAgent);
    }

    // --- CLAIM path (New or unlinked vehicle) ---------------------------------
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

    const recentRejects = await countRecentRejects(admin, user.id);
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

    // 1. Quota check: do NOT deduct the live sync credit yet
    await enforceDailyQuota(admin, user.id);

    const provider = createVehicleDataProvider();
    let upstreamRaw: StandardVehicleCompliance;

    try {
      upstreamRaw = await provider.getVehicleDetails(regNumber);
    } catch (upstreamErr) {
      // Upstream failed: credit is preserved untouched
      throw upstreamErr;
    }

    const scrubbed = scrubVehicleCompliance({ ...upstreamRaw, regNumber });
    const upstreamChassis = normalizeChassisLast5(scrubbed.chassisLast5);
    const isChassisMatch = Boolean(
      upstreamChassis && upstreamChassis === chassisSubmitted,
    );

    // 2. Cache vehicle record immediately so subsequent attempts hit cache
    const vehicleRow = await upsertVehicle(admin, {
      userId: isChassisMatch ? user.id : null,
      existingId: existingVehicle?.id,
      vehicle: scrubbed,
      chassisLast5: upstreamChassis,
      isVerifiedOwner: isChassisMatch,
    });

    if (!isChassisMatch) {
      await recordClaimAttempt(admin, user.id, regNumber, chassisSubmitted, 'rejected');
      await recordVehicleLookup(admin, user.id, regNumber, false);
      return jsonResponse(
        {
          success: false,
          error:
            'Chassis last 5 does not match RC records. Check your registration certificate and try again.',
        } satisfies ApiResponse<never>,
        403,
      );
    }

    // 3. Chassis verified: fetch challans, persist, THEN consume credit (zero-leakage).
    await recordClaimAttempt(admin, user.id, regNumber, chassisSubmitted, 'verified');

    const upstreamChallans = await provider.getPendingChallans(
      regNumber,
      scrubbed.chassisLast5 ?? undefined,
    );

    await upsertChallans(admin, vehicleRow.id, upstreamChallans);
    await assertAndConsumeLiveSync(admin, user.id);
    await grantVehicleEntitlement(admin, user.id, vehicleRow.id, claimGate.mode);
    await recordVehicleLookup(admin, user.id, regNumber, false);

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

    const clientVehicle = toClientVehicle(scrubbed);
    const payload: SyncVehicleResponseData = {
      source: 'UPSTREAM',
      vehicle: clientVehicle,
      challans: upstreamChallans,
      compliance: computeCompliance(clientVehicle, upstreamChallans),
    };

    return jsonResponse({
      success: true,
      data: payload,
    } satisfies ApiResponse<SyncVehicleResponseData>);
  } catch (err) {
    return handleError(err);
  }
});

async function enforceDailyQuota(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: profile } = await admin
    .from('profiles')
    .select('is_pro')
    .eq('id', userId)
    .maybeSingle();

  const maxDaily =
    profile?.is_pro === true
      ? dailyLookupQuotaForPro()
      : DEFAULT_DAILY_LOOKUP_QUOTA;

  await assertUserLookupQuota(admin, userId, maxDaily);
}

async function recordVehicleLookup(
  admin: SupabaseClient,
  userId: string,
  regNumber: string,
  isCacheHit: boolean,
): Promise<void> {
  const { error } = await admin.from('vehicle_lookups').insert({
    user_id: userId,
    reg_number: regNumber,
    is_cache_hit: isCacheHit,
  });
  if (error) {
    console.error('vehicle_lookups insert failed', error.message);
  }
}

async function attachVerifiedOwner(
  admin: SupabaseClient,
  vehicleId: string,
  userId: string,
  chassisLast5: string,
): Promise<void> {
  const claimGate = await assertCanClaimVehicle(admin, userId);
  if (!claimGate.ok) {
    throw new HttpAppError(claimGate.message, 402);
  }

  const { error } = await admin
    .from('vehicles')
    .update({
      user_id: userId,
      chassis_last_5: chassisLast5,
      is_verified_owner: true,
    })
    .eq('id', vehicleId);

  if (error) {
    console.error('attachVerifiedOwner failed', error.message);
    throw new HttpAppError('Failed to attach verified ownership.', 500);
  }

  await grantVehicleEntitlement(admin, userId, vehicleId, claimGate.mode);
}

async function respondFromCache(
  admin: SupabaseClient,
  existingVehicle: DbVehicleRow,
): Promise<Response> {
  const { data: cachedChallans, error: challanLookupError } = await admin
    .from('challans')
    .select(
      'challan_number, amount, violation_date, violation_type, location, evidence_url, status',
    )
    .eq('vehicle_id', existingVehicle.id);

  if (challanLookupError) {
    console.error('challans lookup failed', challanLookupError.message);
    return jsonResponse(
      { success: false, error: 'Failed to query challans.' } satisfies ApiResponse<never>,
      500,
    );
  }

  const vehicle = toClientVehicle(vehicleFromDbRow(existingVehicle));
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
  admin: SupabaseClient,
  userId: string,
  existingId: string | undefined,
  regNumber: string,
  opts: {
    chassisSubmitted: string | null;
    attachOwner: boolean;
    verifiedOwner: boolean;
  },
  ip: string,
  userAgent: string,
): Promise<Response> {
  const provider = createVehicleDataProvider();
  const upstreamRaw = await provider.getVehicleDetails(regNumber);
  const scrubbed = scrubVehicleCompliance({ ...upstreamRaw, regNumber });

  let isVerifiedOwner = opts.verifiedOwner;
  let chassisLast5 = normalizeChassisLast5(scrubbed.chassisLast5);

  if (opts.chassisSubmitted) {
    const upstreamChassis = chassisLast5;
    if (upstreamChassis && upstreamChassis === opts.chassisSubmitted) {
      isVerifiedOwner = true;
      chassisLast5 = opts.chassisSubmitted;
    } else {
      isVerifiedOwner = false;
    }
  }

  // Persist RC + challans first; burn credit only after successful upstream mapping.
  const upstreamChallans = await provider.getPendingChallans(
    regNumber,
    chassisLast5 ?? undefined,
  );

  const vehicleRow = await upsertVehicle(admin, {
    userId: opts.attachOwner ? userId : null,
    existingId,
    vehicle: scrubbed,
    chassisLast5,
    isVerifiedOwner: opts.attachOwner ? isVerifiedOwner : false,
  });

  await upsertChallans(admin, vehicleRow.id, upstreamChallans);
  await assertAndConsumeLiveSync(admin, userId);
  await recordVehicleLookup(admin, userId, regNumber, false);

  await writeAuditLog(admin, {
    userId,
    eventType: 'CHALLAN_QUERY',
    ipAddress: ip,
    userAgent,
    requestPayload: {
      regNumber,
      challanCount: upstreamChallans.length,
      source: 'UPSTREAM',
    },
  });

  const clientVehicle = toClientVehicle(scrubbed);
  const payload: SyncVehicleResponseData = {
    source: 'UPSTREAM',
    vehicle: clientVehicle,
    challans: upstreamChallans,
    compliance: computeCompliance(clientVehicle, upstreamChallans),
  };

  return jsonResponse({
    success: true,
    data: payload,
  } satisfies ApiResponse<SyncVehicleResponseData>);
}

function assertOptionalChassisLast5(
  raw: string | null | undefined,
): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const normalized = normalizeChassisLast5(raw);
  if (!normalized || normalized.length !== 5) {
    throw new SecurityValidationError(
      'chassisLast5 must be exactly 5 alphanumeric characters from your RC.',
    );
  }
  return normalized;
}

async function recordClaimAttempt(
  admin: SupabaseClient,
  userId: string,
  regNumber: string,
  chassisLast5: string,
  outcome: 'verified' | 'rejected' | 'conflict',
): Promise<void> {
  const { error } = await admin.from('vehicle_claim_attempts').insert({
    user_id: userId,
    reg_number: regNumber,
    chassis_last_5_submitted: chassisLast5,
    outcome,
  });
  if (error) {
    console.error('vehicle_claim_attempts insert failed', error.message);
  }
}

async function countRecentRejects(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('vehicle_claim_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('outcome', 'rejected')
    .gte('created_at', since);

  if (error) {
    console.error('claim reject count failed', error.message);
    return 0;
  }
  return count ?? 0;
}

async function upsertVehicle(
  admin: SupabaseClient,
  input: {
    userId: string | null;
    existingId: string | undefined;
    vehicle: StandardVehicleCompliance;
    chassisLast5: string | null;
    isVerifiedOwner: boolean;
  },
): Promise<{ id: string }> {
  const contact = input.vehicle.contactCompliance ?? linkedContactCompliance();
  const mobileLinked = contact.mobileLinked !== false;
  const aadhaarLinked = contact.aadhaarLinked !== false;
  const rcContactWarning = !mobileLinked || !aadhaarLinked;
  const nowIso = new Date().toISOString();

  const row = {
    ...(input.existingId ? { id: input.existingId } : {}),
    user_id: input.userId,
    reg_number: input.vehicle.regNumber,
    chassis_last_5: input.chassisLast5,
    engine_last_5: normalizeChassisLast5(input.vehicle.engineLast5),
    maker_model: input.vehicle.makerModel || null,
    fuel_type: input.vehicle.fuelType,
    puc_expiry_date: toDateOnly(input.vehicle.puc.validUpto),
    insurance_expiry_date: toDateOnly(input.vehicle.insurance.validUpto),
    fitness_expiry_date: toDateOnly(input.vehicle.fitness.validUpto),
    fastag_status: input.vehicle.fastagStatus ?? null,
    fastag_bank: null,
    rc_mobile_linked: mobileLinked,
    rc_aadhaar_linked: aadhaarLinked,
    rc_contact_warning: rcContactWarning,
    is_verified_owner: input.isVerifiedOwner,
    last_polled_at: nowIso,
    cached_until: vehicleCacheUntilIso(new Date(nowIso)),
    ...(rcContactWarning ? {} : { contact_audit_notified: false }),
  };

  const { data, error } = await admin
    .from('vehicles')
    .upsert(row, { onConflict: 'reg_number' })
    .select('id, contact_audit_notified, rc_contact_warning')
    .single();

  if (error || !data) {
    console.error('vehicles upsert failed', error?.message);
    throw new HttpAppError(
      error?.code === '23505'
        ? 'This registration number is already linked to another account.'
        : `Failed to upsert vehicle: ${error?.message ?? 'unknown error'}`,
      error?.code === '23505' ? 409 : 500,
    );
  }

  const saved = data as {
    id: string;
    contact_audit_notified: boolean | null;
    rc_contact_warning: boolean | null;
  };

  if (input.userId && rcContactWarning && !saved.contact_audit_notified) {
    await maybeDispatchRcContactWarning(
      admin,
      input.userId,
      saved.id,
      input.vehicle,
    );
  }

  return { id: saved.id };
}

async function maybeDispatchRcContactWarning(
  admin: SupabaseClient,
  userId: string,
  vehicleId: string,
  vehicle: StandardVehicleCompliance,
): Promise<void> {
  try {
    const { data: profile, error } = await admin
      .from('profiles')
      .select(
        'id, full_name, phone_number, preferred_channel, telegram_chat_id, signal_number',
      )
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) {
      console.warn('RC contact warning skipped — profile missing', error?.message);
      return;
    }

    if (!profile.telegram_chat_id && !profile.phone_number) {
      console.warn(
        'RC contact warning skipped — no Telegram chat or phone on profile',
      );
      return;
    }

    const contact = vehicle.contactCompliance ?? linkedContactCompliance();

    await notificationDispatcher.dispatch({
      userId,
      ownerName: profile.full_name,
      preferredChannel: profile.preferred_channel,
      phoneNumber: profile.phone_number,
      telegramChatId: profile.telegram_chat_id,
      signalNumber: profile.signal_number,
      regNumber: vehicle.regNumber,
      makerModel: vehicle.makerModel || null,
      pucExpiryDate: vehicle.puc.validUpto,
      daysLeft: 0,
      alertType: 'RC_CONTACT_WARNING',
      alertLabel: 'RC Contact',
      maskedMobile: null,
      warningNotice: contact.warningNotice ?? null,
    });

    const { error: flagError } = await admin
      .from('vehicles')
      .update({ contact_audit_notified: true })
      .eq('id', vehicleId);

    if (flagError) {
      console.error('contact_audit_notified update failed', flagError.message);
    }
  } catch (err) {
    console.error('RC_CONTACT_WARNING dispatch failed', err);
  }
}

async function upsertChallans(
  admin: SupabaseClient,
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

  const { error } = await admin
    .from('challans')
    .upsert(rows, { onConflict: 'challan_number' });

  if (error) {
    console.error('challans upsert failed', error.message);
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

  if (err instanceof LiveSyncEntitlementError) {
    return jsonResponse(
      { success: false, error: err.message } satisfies ApiResponse<never>,
      err.status,
    );
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
      error: 'Internal server error',
    } satisfies ApiResponse<never>,
    500,
  );
}