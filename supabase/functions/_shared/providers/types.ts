/**
 * Normalized vehicle / challan contracts for IVehicleDataProvider adapters
 * (MOCK, SETU_SANDBOX, and production providers).
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

export interface ChallanItem {
  challanNumber: string;
  amount: number;
  violationType: string;
  violationDate: string;
  location: string;
  status: ChallanProviderStatus;
  evidenceUrl?: string;
  challanPdfUrl?: string;
}

export interface StandardVehicleCompliance {
  regNumber: string;
  chassisLast5?: string;
  engineLast5?: string;
  makerModel: string;
  fuelType: FuelType;
  registrationDate?: string;
  puc: {
    isValid: boolean;
    validUpto: string | null;
    /** May be negative when PUC is overdue (e.g. -5). */
    daysRemaining: number;
    pucNumber?: string;
  };
  insurance: {
    isValid: boolean;
    validUpto: string | null;
    companyName?: string | null;
    policyNumber?: string;
  };
  fitness: {
    validUpto: string | null;
  };
  challans?: ChallanItem[];
  fastagStatus?: string | null;
  fastagBank?: string | null;
}

export interface IVehicleDataProvider {
  getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance>;
  getPendingChallans(
    regNumber: string,
    chassisLast5?: string,
  ): Promise<ChallanItem[]>;
}

export type VehicleProviderMode = 'MOCK' | 'SETU_SANDBOX' | 'SUREPASS_PROD' | 'SETU_PROD';
