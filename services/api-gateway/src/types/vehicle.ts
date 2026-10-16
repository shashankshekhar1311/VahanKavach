export interface StandardVehicleCompliance {
  regNumber: string;
  chassisLast5?: string;
  engineLast5?: string;
  makerModel: string;
  fuelType: 'PETROL' | 'DIESEL' | 'CNG' | 'ELECTRIC' | 'HYBRID' | 'OTHER';
  registrationDate: string;
  puc: {
    isValid: boolean;
    validUpto: string | null; // ISO 8601
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
}

export interface ChallanItem {
  challanNumber: string;
  amount: number;
  violationDate: string; // ISO 8601
  violationType: string;
  location: string;
  status: 'UNPAID' | 'PAID' | 'DISPUTED';
  evidenceUrl?: string;
  challanPdfUrl?: string;
}

export interface IVehicleDataProvider {
  getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance>;
  getPendingChallans(regNumber: string, chassisLast5?: string): Promise<ChallanItem[]>;
}