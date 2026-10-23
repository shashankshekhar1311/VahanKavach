/**
 * Vehicle data provider factory for staging / production.
 *
 * Primary env: VEHICLE_PROVIDER = MOCK | SETU_SANDBOX | SUREPASS_PROD | SETU_PROD
 * Legacy:      VEHICLE_PROVIDER_MODE, USE_MOCK_PROVIDER=true
 *
 * Graceful fallback: if Setu/Surepass construction fails, falls back to MOCK
 * and logs the reason (keeps sandbox usable with zero external cost).
 */

import type { IVehicleDataProvider, VehicleProviderMode } from './types.ts';
import { MockVehicleProvider } from './mock.provider.ts';
import { SetuProvider } from './setu.provider.ts';
import { SurepassProvider } from './surepass.provider.ts';
import { safeLog } from './resilience.ts';

export function resolveVehicleProviderMode(): VehicleProviderMode {
  const legacyMock =
    (Deno.env.get('USE_MOCK_PROVIDER') ?? '').toLowerCase() === 'true';
  if (legacyMock) return 'MOCK';

  const raw = (
    Deno.env.get('VEHICLE_PROVIDER') ??
    Deno.env.get('VEHICLE_PROVIDER_MODE') ??
    'MOCK'
  )
    .trim()
    .toUpperCase();

  if (raw === 'SETU_SANDBOX' || raw === 'SETU-SANDBOX') return 'SETU_SANDBOX';
  if (raw === 'SUREPASS_PROD' || raw === 'SUREPASS') return 'SUREPASS_PROD';
  if (raw === 'SETU_PROD' || raw === 'SETU') return 'SETU_PROD';
  if (raw === 'MOCK') return 'MOCK';

  safeLog('unknown VEHICLE_PROVIDER — defaulting to MOCK', { raw });
  return 'MOCK';
}

/**
 * Returns the active vehicle data provider.
 * Prefer this name in Edge Functions; createVehicleDataProvider is an alias.
 */
export function getVehicleProvider(): IVehicleDataProvider {
  const mode = resolveVehicleProviderMode();
  safeLog('vehicle provider selected', { mode });

  try {
    switch (mode) {
      case 'SETU_SANDBOX':
        return new SetuProvider({
          sandbox: true,
          authMode: 'headers',
          baseUrl:
            Deno.env.get('SETU_BASE_URL')?.trim() ||
            'https://sandbox.setu.co/api/v1',
        });
      case 'SETU_PROD':
        return new SetuProvider({
          sandbox: false,
          authMode:
            (Deno.env.get('SETU_AUTH_MODE') ?? 'oauth').toLowerCase() ===
            'headers'
              ? 'headers'
              : 'oauth',
        });
      case 'SUREPASS_PROD':
        return new SurepassProvider();
      case 'MOCK':
      default:
        return new MockVehicleProvider();
    }
  } catch (err) {
    safeLog('provider init failed — falling back to MOCK', {
      mode,
      error: err instanceof Error ? err.message : String(err),
    });
    return new MockVehicleProvider();
  }
}

/** @deprecated Prefer getVehicleProvider() */
export function createVehicleDataProvider(): IVehicleDataProvider {
  return getVehicleProvider();
}

/** Base URL used for health latency probes (no credentials). */
export function providerProbeUrl(mode?: VehicleProviderMode): string | null {
  const m = mode ?? resolveVehicleProviderMode();
  switch (m) {
    case 'SUREPASS_PROD':
      return (
        Deno.env.get('SUREPASS_BASE_URL')?.trim() ||
        'https://kyc-api.surepass.io/api/v1'
      );
    case 'SETU_SANDBOX':
      return (
        Deno.env.get('SETU_BASE_URL')?.trim() ||
        'https://sandbox.setu.co/api/v1'
      );
    case 'SETU_PROD':
      return Deno.env.get('SETU_BASE_URL')?.trim() || 'https://dg.setu.co/api';
    case 'MOCK':
    default:
      return null;
  }
}
