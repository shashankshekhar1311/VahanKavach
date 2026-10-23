/**
 * health — production readiness probe.
 *
 * Checks: Postgres connectivity, pg_cron-backed job artefacts, upstream latency.
 * verify_jwt = false (uptime monitors / deploy smoke tests).
 *
 * Healthy response data:
 *   { status: 'healthy', version: '1.0.0', timestamp: ISO8601 }
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
    provider: CheckResult & { mode: VehicleProviderMode };
  };
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(
      { success: false, error: 'Method not allowed' } satisfies ApiResponse<never>,
      405,
    );
  }

  const timestamp = new Date().toISOString();
  const mode = resolveVehicleProviderMode();

  const database = await checkDatabase();
  const pgCron = await checkPgCron(database.admin);
  const provider = await checkProvider(mode);

  const checks = {
    database: { ok: database.ok, detail: database.detail },
    pg_cron: pgCron,
    provider: { ...provider, mode },
  };

  const allOk = database.ok && pgCron.ok && provider.ok;
  const status: HealthData['status'] = !database.ok
    ? 'unhealthy'
    : allOk
    ? 'healthy'
    : 'degraded';

  if (status === 'healthy') {
    return jsonResponse({
      success: true,
      data: {
        status: 'healthy',
        version: APP_VERSION,
        timestamp,
        checks,
      } satisfies HealthData,
    } satisfies ApiResponse<HealthData>);
  }

  return jsonResponse(
    {
      success: false,
      error: `Service ${status}`,
      data: {
        status,
        version: APP_VERSION,
        timestamp,
        checks,
      } satisfies HealthData,
    } as Record<string, unknown>,
    status === 'unhealthy' ? 503 : 200,
  );
});


async function checkDatabase(): Promise<{
  ok: boolean;
  detail?: string;
  admin: SupabaseClient | null;
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return {
      ok: false,
      detail: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing',
      admin: null,
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.from('profiles').select('id').limit(1);
  if (error) {
    return { ok: false, detail: error.message, admin };
  }
  return { ok: true, detail: 'profiles reachable', admin };
}

/**
 * pg_cron schema is not exposed via PostgREST; verify artefacts that require
 * pg_cron (audit 180-day job + PUC daily job migrations).
 */
async function checkPgCron(admin: SupabaseClient | null): Promise<CheckResult> {
  if (!admin) return { ok: false, detail: 'no db client' };

  const { error: auditErr } = await admin.from('audit_logs').select('id').limit(1);
  if (auditErr) {
    return {
      ok: false,
      detail: `audit_logs missing (180-day retention cron depends on it): ${auditErr.message}`,
    };
  }

  const { error: pucErr } = await admin
    .from('puc_alert_dispatches')
    .select('id')
    .limit(1);

  if (pucErr) {
    return {
      ok: true,
      detail:
        'audit retention artefacts ok; puc_alert_dispatches not found (partial cron setup)',
    };
  }

  return {
    ok: true,
    detail: 'pg_cron-backed tables present (audit retention + puc alerts)',
  };
}

async function checkProvider(mode: VehicleProviderMode): Promise<CheckResult> {
  if (mode === 'MOCK') {
    return { ok: true, detail: 'MOCK mode — no upstream probe', latencyMs: 0 };
  }

  const url = providerProbeUrl(mode);
  if (!url) {
    return { ok: false, detail: 'no probe URL for provider mode' };
  }

  const probe = await probeUpstreamLatency(url);
  return {
    ok: probe.ok,
    detail: probe.ok
      ? `upstream reachable (HTTP ${probe.status ?? 'n/a'})`
      : 'upstream probe failed or timed out',
    latencyMs: probe.latencyMs,
  };
}
