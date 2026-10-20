/**
 * Normalized vehicle / challan contracts shared by upstream providers
 * and the sync-vehicle Edge Function.
 */

export type FuelType =
  | 'PETROL'
  | 'DIESEL'
  | 'CNG'
  | 'ELECTRIC'
  | 'HYBRID'
  | 'OTHER';

/** Provider-facing challan status (mapped to DB enum on upsert). */
export type ChallanProviderStatus = 'UNPAID' | 'PAID' | 'DISPUTED';

/** Database `public.challan_status` enum. */
export type ChallanDbStatus =
  | 'UNPAID'
  | 'PAID_EXTERNALLY'
  | 'PAID_VIA_APP'
  | 'DISPUTED';

export interface StandardVehicleCompliance {
  regNumber: string;
  chassisLast5?: string;
  engineLast5?: string;
  makerModel: string;
  fuelType: FuelType;
  registrationDate: string;
  puc: {
    isValid: boolean;
    validUpto: string | null;
    daysRemaining: number;
    pucNumber?: string;
  };
  insurance: {
    isValid: boolean;
    validUpto: string | null;
    companyName: string | null;
    policyNumber?: string;
  };
  fitness: {
    validUpto: string | null;
  };
  fastagStatus?: string | null;
  fastagBank?: string | null;
}

export interface ChallanItem {
  challanNumber: string;
  amount: number;
  violationDate: string;
  violationType: string;
  location: string;
  status: ChallanProviderStatus;
  evidenceUrl?: string;
  challanPdfUrl?: string;
}

export interface IVehicleDataProvider {
  getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance>;
  getPendingChallans(
    regNumber: string,
    chassisLast5?: string,
  ): Promise<ChallanItem[]>;
}

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
  vehicle: StandardVehicleCompliance;
  challans: ChallanItem[];
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
