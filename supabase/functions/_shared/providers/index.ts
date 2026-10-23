/**
 * Vehicle data provider barrel — re-exports factory + adapters.
 */

export type {
  ChallanItem,
  ChallanProviderStatus,
  FuelType,
  IVehicleDataProvider,
  StandardVehicleCompliance,
  VehicleProviderMode,
} from './types.ts';

export {
  createVehicleDataProvider,
  getVehicleProvider,
  providerProbeUrl,
  resolveVehicleProviderMode,
} from './factory.ts';

export { MockVehicleProvider, MOCK_TEST_VEHICLES } from './mock.provider.ts';
export { SurepassProvider, ProviderHttpError } from './surepass.provider.ts';
export { SetuProvider } from './setu.provider.ts';
export {
  CircuitOpenError,
  maskSecrets,
  probeUpstreamLatency,
  safeLog,
  withRetryAndCircuit,
} from './resilience.ts';
