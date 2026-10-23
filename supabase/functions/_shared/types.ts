/**
 * Normalized vehicle / challan contracts shared by upstream providers
 * and the sync-vehicle Edge Function.
 *
 * Provider-facing shapes live in `./providers/types.ts` and are re-exported here
 * so existing Edge Function imports keep working.
 */

export type {
  ChallanItem,
  ChallanProviderStatus,
  FuelType,
  IVehicleDataProvider,
  StandardVehicleCompliance,
} from './providers/types.ts';

import type { ChallanProviderStatus } from './providers/types.ts';

/** Database `public.challan_status` enum. */
export type ChallanDbStatus =
  | 'UNPAID'
  | 'PAID_EXTERNALLY'
  | 'PAID_VIA_APP'
  | 'DISPUTED';

export interface SyncVehicleRequest {
  regNumber: string;
  forceRefresh?: boolean;
}

export interface ComplianceFlags {
  isPucExpired: boolean;
  isInsuranceExpired: boolean;
  isFitnessExpired: boolean;
  pendingChallanCount: number;
  totalChallanAmount: number;
}

export interface SyncVehicleResponseData {
  source: 'CACHE' | 'UPSTREAM';
  vehicle: import('./providers/types.ts').StandardVehicleCompliance;
  challans: import('./providers/types.ts').ChallanItem[];
  compliance: ComplianceFlags;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Map provider challan status → database enum. */
export function toDbChallanStatus(status: ChallanProviderStatus): ChallanDbStatus {
  switch (status) {
    case 'PAID':
      return 'PAID_EXTERNALLY';
    case 'DISPUTED':
      return 'DISPUTED';
    case 'UNPAID':
    default:
      return 'UNPAID';
  }
}

/** Map database challan status → provider / API status. */
export function toProviderChallanStatus(
  status: ChallanDbStatus | string,
): ChallanProviderStatus {
  switch (status) {
    case 'PAID_EXTERNALLY':
    case 'PAID_VIA_APP':
      return 'PAID';
    case 'DISPUTED':
      return 'DISPUTED';
    case 'UNPAID':
    default:
      return 'UNPAID';
  }
}
