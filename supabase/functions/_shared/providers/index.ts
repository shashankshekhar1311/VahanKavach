import type { IVehicleDataProvider } from '../types.ts';
import { MockVehicleProvider } from './mock.provider.ts';
import { SurepassProvider } from './surepass.provider.ts';

/**
 * Resolve the active vehicle data provider.
 * Prefer mock when USE_MOCK_PROVIDER="true" (local/CI).
 */
export function createVehicleDataProvider(): IVehicleDataProvider {
  const useMock = (Deno.env.get('USE_MOCK_PROVIDER') ?? '').toLowerCase() === 'true';

  if (useMock) {
    return new MockVehicleProvider();
  }

  return new SurepassProvider();
}

export { MockVehicleProvider } from './mock.provider.ts';
export { SurepassProvider, ProviderHttpError } from './surepass.provider.ts';
