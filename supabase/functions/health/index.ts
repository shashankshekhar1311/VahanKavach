/**
 * health — production readiness probe.
 *
 * Public response is minimal (status/version/timestamp only).
 * Detailed checks require header x-health-secret === HEALTH_PROBE_SECRET.
 * verify_jwt = false (uptime monitors).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { jsonResponse, optionsResponse } from '../_shared/cors.ts';
import {
  probeUpstreamLatency,
  providerProbeUrl,
  resolveVehicleProviderMode,
  type VehicleProviderMode,
} from '../_shared/providers/index.ts';
import type { ApiResponse } from '../_shared/types.ts';

const APP_VERSION = '1.0.0';

type CheckResult = {
  ok: boolean;
  detail?: string;
  latencyMs?: number | null;
};

type HealthData = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  checks?: {
    database: CheckResult;
    pg_cron: CheckResult;
    provider: CheckResult & { mode?: VehicleProviderMode };
  };
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return optionsResponse(req);
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed' } satisfies ApiResponse<never>,
      405,
      {},
      req,
    );
  }

  const timestamp = new Date().toISOString();
  const probeSecret = Deno.env.get('HEALTH_PROBE_SECRET')?.trim() ?? '';
  const provided = req.headers.get('x-health-secret')?.trim() ?? '';
  const detailed = Boolean(probeSecret) && timingSafeEqual(probeSecret, provided);

  const database = await checkDatabase();
  const status: HealthData['status'] = database.ok ? 'healthy' : 'unhealthy';

  if (!detailed) {
    return jsonResponse(
      {
        success: database.ok,
        data: {
          status,
          version: APP_VERSION,
          timestamp,
        } satisfies HealthData,
      } satisfies ApiResponse<HealthData>,
      database.ok ? 200 : 503,
      {},
      req,
    );
  }

  const mode = resolveVehicleProviderMode();
  const pgCron = await checkPgCron(database.admin);
  const provider = await checkProvider(mode);
  const checks = {
    database: {
      ok: database.ok,
      detail: database.ok ? 'ok' : 'unreachable',
    },
    pg_cron: { ok: pgCron.ok, detail: pgCron.ok ? 'ok' : 'degraded' },
    provider: {
      ok: provider.ok,
      latencyMs: provider.latencyMs,
      mode,
    },
  };

  const allOk = database.ok && pgCron.ok && provider.ok;
  const detailedStatus: HealthData['status'] = !database.ok
    ? 'unhealthy'
    : allOk
      ? 'healthy'
      : 'degraded';

  return jsonResponse(
    {
      success: detailedStatus !== 'unhealthy',
      data: {
        status: detailedStatus,
        version: APP_VERSION,
        timestamp,
        checks,
      } satisfies HealthData,
    } as Record<string, unknown>,
    detailedStatus === 'unhealthy' ? 503 : 200,
    {},
    req,
  );
});

async function checkDatabase(): Promise<{
  ok: boolean;
  admin: SupabaseClient | null;
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, admin: null };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.from('profiles').select('id').limit(1);
  if (error) {
    console.error('health db', error.message);
    return { ok: false, admin };
  }
  return { ok: true, admin };
}

async function checkPgCron(admin: SupabaseClient | null): Promise<CheckResult> {
  if (!admin) return { ok: false, detail: 'no db client' };
  const { error } = await admin.from('audit_logs').select('id').limit(1);
  if (error) {
    console.error('health pg_cron artefact', error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function checkProvider(mode: VehicleProviderMode): Promise<CheckResult> {
  const url = providerProbeUrl(mode);
  if (!url) return { ok: true, latencyMs: 0, detail: 'mock' };
  try {
    const latencyMs = await probeUpstreamLatency(url);
    return { ok: latencyMs != null && latencyMs < 5000, latencyMs };
  } catch (err) {
    console.error('health provider', err);
    return { ok: false, latencyMs: null };
  }
}
