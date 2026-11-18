/**
 * Vehicle data provider factory.
 *
 * VEHICLE_PROVIDER_MODE: 'MOCK' | 'SUREPASS_PROD' | 'SETU_PROD' | 'DEEPVUE_PROD'
 * Legacy: USE_MOCK_PROVIDER=true still forces MOCK.
 */

import type { IVehicleDataProvider } from '../types.ts';
import { DeepvueProvider } from './deepvue.provider.ts';
import { MockVehicleProvider } from './mock.provider.ts';
import { SetuProvider } from './setu.provider.ts';
import { SurepassProvider } from './surepass.provider.ts';
import { safeLog } from './resilience.ts';

export type VehicleProviderMode =
  | 'MOCK'
  | 'SUREPASS_PROD'
  | 'SETU_PROD'
  | 'DEEPVUE_PROD';

export function resolveVehicleProviderMode(): VehicleProviderMode {
  const legacyMock =
    (Deno.env.get('USE_MOCK_PROVIDER') ?? '').toLowerCase() === 'true';
  if (legacyMock) return 'MOCK';

  const raw = (Deno.env.get('VEHICLE_PROVIDER_MODE') ?? 'MOCK')
    .trim()
    .toUpperCase();

  if (raw === 'SUREPASS_PROD' || raw === 'SUREPASS') return 'SUREPASS_PROD';
  if (raw === 'SETU_PROD' || raw === 'SETU') return 'SETU_PROD';
  if (raw === 'DEEPVUE_PROD' || raw === 'DEEPVUE') return 'DEEPVUE_PROD';
  if (raw === 'MOCK') return 'MOCK';

  safeLog('unknown VEHICLE_PROVIDER_MODE — defaulting to MOCK', { raw });
  return 'MOCK';
}

/**
 * Resolve the active vehicle data provider (with retry/circuit inside adapters).
 */
export function createVehicleDataProvider(): IVehicleDataProvider {
  const mode = resolveVehicleProviderMode();
  safeLog('vehicle provider selected', { mode });

  switch (mode) {
    case 'SUREPASS_PROD':
      return new SurepassProvider();
    case 'SETU_PROD':
      return new SetuProvider();
    case 'DEEPVUE_PROD':
      return new DeepvueProvider();
    case 'MOCK':
    default:
      return new MockVehicleProvider();
  }
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
    case 'SETU_PROD':
      return Deno.env.get('SETU_BASE_URL')?.trim() || 'https://dg.setu.co/api';
    case 'DEEPVUE_PROD':
      return Deno.env.get('DEEPVUE_BASE_URL')?.trim() || 'https://api.deepvue.ai/v1';
    case 'MOCK':
    default:
      return null;
  }
}

export { MockVehicleProvider } from './mock.provider.ts';
export { SurepassProvider, ProviderHttpError } from './surepass.provider.ts';
export { SetuProvider } from './setu.provider.ts';
export { DeepvueProvider } from './deepvue.provider.ts';
export {
  contactComplianceFromRcData,
  linkedContactCompliance,
  PARIVAHAN_MOBILE_UPDATE_URL,
  RC_CONTACT_WARNING_NOTICE,
  unlinkedContactCompliance,
} from './contact-compliance.ts';
export {
  CircuitOpenError,
  maskSecrets,
  probeUpstreamLatency,
  safeLog,
  withRetryAndCircuit,
} from './resilience.ts';
