/**
 * Deterministic mock provider for local / CI testing.
 * Enabled when USE_MOCK_PROVIDER="true".
 */

import type {
  ChallanItem,
  IVehicleDataProvider,
  StandardVehicleCompliance,
} from '../types.ts';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function daysRemaining(isoDate: string | null): number {
  if (!isoDate) return 0;
  const target = new Date(isoDate);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Seed fixtures keyed by sanitized registration number. */
const FIXTURES: Record<
  string,
  { vehicle: StandardVehicleCompliance; challans: ChallanItem[] }
> = {
  KA01AB1234: {
    vehicle: {
      regNumber: 'KA01AB1234',
      chassisLast5: 'A1B2C',
      engineLast5: '9X8Y7',
      makerModel: 'Maruti Suzuki Baleno',
      fuelType: 'PETROL',
      registrationDate: '2019-06-15',
      puc: {
        isValid: true,
        validUpto: isoDaysFromNow(3),
        daysRemaining: 3,
        pucNumber: 'KA-PUC-991122',
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(180),
        companyName: 'ICICI Lombard',
        policyNumber: 'IL-POL-778899',
      },
      fitness: { validUpto: null },
      fastagStatus: 'ACTIVE',
      fastagBank: 'HDFC Bank',
    },
    challans: [],
  },
  MH12CD5678: {
    vehicle: {
      regNumber: 'MH12CD5678',
      chassisLast5: 'Z9Y8X',
      engineLast5: 'M3N4P',
      makerModel: 'Hyundai Creta',
      fuelType: 'DIESEL',
      registrationDate: '2021-03-22',
      puc: {
        isValid: true,
        validUpto: isoDaysFromNow(120),
        daysRemaining: 120,
        pucNumber: 'MH-PUC-445566',
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(40),
        companyName: 'Bajaj Allianz',
        policyNumber: 'BA-POL-112233',
      },
      fitness: { validUpto: isoDaysFromNow(400) },
      fastagStatus: 'LOW_BALANCE',
      fastagBank: 'ICICI Bank',
    },
    challans: [
      {
        challanNumber: 'MH12CD56780001',
        amount: 2000,
        violationDate: isoDaysFromNow(-12),
        violationType: 'Over Speeding',
        location: 'Western Express Highway, Mumbai',
        status: 'UNPAID',
        evidenceUrl: 'https://example.com/evidence/mh12cd56780001.jpg',
      },
      {
        challanNumber: 'MH12CD56780002',
        amount: 500,
        violationDate: isoDaysFromNow(-4),
        violationType: 'Signal Jump',
        location: 'Bandra West, Mumbai',
        status: 'UNPAID',
      },
    ],
  },
  DL01EF9012: {
    vehicle: {
      regNumber: 'DL01EF9012',
      chassisLast5: 'Q7W6E',
      engineLast5: 'R5T4Y',
      makerModel: 'Tata Nexon EV',
      fuelType: 'ELECTRIC',
      registrationDate: '2023-01-10',
      puc: {
        isValid: false,
        validUpto: isoDaysFromNow(-15),
        daysRemaining: 0,
        pucNumber: 'DL-PUC-000111',
      },
      insurance: {
        isValid: false,
        validUpto: isoDaysFromNow(-5),
        companyName: 'HDFC Ergo',
        policyNumber: 'HE-POL-998877',
      },
      fitness: { validUpto: isoDaysFromNow(200) },
      fastagStatus: 'INACTIVE',
      fastagBank: 'SBI',
    },
    challans: [
      {
        challanNumber: 'DL01EF9012U001',
        amount: 1000,
        violationDate: isoDaysFromNow(-30),
        violationType: 'No Parking',
        location: 'Connaught Place, New Delhi',
        status: 'UNPAID',
      },
    ],
  },
};

function refreshComputedFields(
  vehicle: StandardVehicleCompliance,
): StandardVehicleCompliance {
  const pucDays = daysRemaining(vehicle.puc.validUpto);
  const insValid = vehicle.insurance.validUpto
    ? new Date(vehicle.insurance.validUpto) > new Date()
    : false;

  return {
    ...vehicle,
    puc: {
      ...vehicle.puc,
      daysRemaining: Math.max(0, pucDays),
      isValid: pucDays > 0,
    },
    insurance: {
      ...vehicle.insurance,
      isValid: insValid,
    },
  };
}

function defaultFixture(regNumber: string): {
  vehicle: StandardVehicleCompliance;
  challans: ChallanItem[];
} {
  return {
    vehicle: {
      regNumber,
      chassisLast5: 'XXXXX',
      engineLast5: 'YYYYY',
      makerModel: 'Generic Hatchback',
      fuelType: 'PETROL',
      registrationDate: '2020-01-01',
      puc: {
        isValid: true,
        validUpto: isoDaysFromNow(60),
        daysRemaining: 60,
        pucNumber: 'MOCK-PUC-0001',
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(90),
        companyName: 'Mock Insurance Co.',
        policyNumber: 'MOCK-POL-0001',
      },
      fitness: { validUpto: null },
      fastagStatus: 'ACTIVE',
      fastagBank: 'Mock Bank',
    },
    challans: [],
  };
}

export class MockVehicleProvider implements IVehicleDataProvider {
  async getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance> {
    // Simulate realistic upstream latency.
    await delay(40);
    const fixture = FIXTURES[regNumber] ?? defaultFixture(regNumber);
    return refreshComputedFields(structuredClone(fixture.vehicle));
  }

  async getPendingChallans(
    regNumber: string,
    _chassisLast5?: string,
  ): Promise<ChallanItem[]> {
    await delay(30);
    const fixture = FIXTURES[regNumber] ?? defaultFixture(regNumber);
    return structuredClone(fixture.challans);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
