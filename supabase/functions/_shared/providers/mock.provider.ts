/**
 * Deterministic mock vehicle / challan provider for zero-cost sandbox testing.
 *
 * Fixtures (sanitized plates):
 *   KA01AB1234 — clean (PUC 180d, comprehensive insurance, 0 challans)
 *   KA02CD5678 — urgent (PUC -5d overdue, 2 ANPR challans)
 *   DL01EF9012 — warning (PUC 3d, 1 parking challan ₹500)
 *   Other valid plates — randomized but deterministic compliance data
 */

import type {
  ChallanItem,
  FuelType,
  IVehicleDataProvider,
  StandardVehicleCompliance,
} from './types.ts';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function daysRemainingFromIso(isoDate: string | null): number {
  if (!isoDate) return 0;
  const target = new Date(isoDate);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Known sandbox chassis last-5 values (for claim / Protect in Quick Add). */
export const MOCK_TEST_VEHICLES = {
  KA01AB1234: { chassisLast5: 'A1B2C', label: 'Clean — valid PUC' },
  KA02CD5678: { chassisLast5: 'C3D4E', label: 'Urgent — expired PUC + 2 challans' },
  DL01EF9012: { chassisLast5: 'E5F6G', label: 'Warning — PUC in 3 days' },
} as const;

type FixtureBundle = {
  vehicle: StandardVehicleCompliance;
  challans: ChallanItem[];
};

const FIXTURES: Record<string, FixtureBundle> = {
  KA01AB1234: {
    vehicle: {
      regNumber: 'KA01AB1234',
      chassisLast5: MOCK_TEST_VEHICLES.KA01AB1234.chassisLast5,
      engineLast5: '9X8Y7',
      makerModel: 'Maruti Suzuki Baleno',
      fuelType: 'PETROL',
      registrationDate: '2019-06-15',
      puc: {
        isValid: true,
        validUpto: isoDaysFromNow(180),
        daysRemaining: 180,
        pucNumber: 'KA-PUC-991122',
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(365),
        companyName: 'ICICI Lombard',
        policyNumber: 'IL-POL-778899',
      },
      fitness: { validUpto: isoDaysFromNow(400) },
      fastagStatus: 'ACTIVE',
      fastagBank: 'HDFC Bank',
    },
    challans: [],
  },
  KA02CD5678: {
    vehicle: {
      regNumber: 'KA02CD5678',
      chassisLast5: MOCK_TEST_VEHICLES.KA02CD5678.chassisLast5,
      engineLast5: 'M3N4P',
      makerModel: 'Hyundai Creta',
      fuelType: 'DIESEL',
      registrationDate: '2021-03-22',
      puc: {
        isValid: false,
        validUpto: isoDaysFromNow(-5),
        daysRemaining: -5,
        pucNumber: 'KA-PUC-445566',
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(90),
        companyName: 'Bajaj Allianz',
        policyNumber: 'BA-POL-112233',
      },
      fitness: { validUpto: isoDaysFromNow(200) },
      fastagStatus: 'ACTIVE',
      fastagBank: 'ICICI Bank',
    },
    challans: [
      {
        challanNumber: 'KA02CD5678ANPR001',
        amount: 1000,
        violationDate: isoDaysFromNow(-12),
        violationType: 'Over-speeding',
        location: 'ANPR Camera — Outer Ring Road, Bengaluru',
        status: 'UNPAID',
        evidenceUrl: 'https://example.com/evidence/ka02cd5678-overspeed.jpg',
      },
      {
        challanNumber: 'KA02CD5678ANPR002',
        amount: 500,
        violationDate: isoDaysFromNow(-4),
        violationType: 'Signal jump',
        location: 'ANPR Camera — MG Road Junction, Bengaluru',
        status: 'UNPAID',
        evidenceUrl: 'https://example.com/evidence/ka02cd5678-signal.jpg',
      },
    ],
  },
  DL01EF9012: {
    vehicle: {
      regNumber: 'DL01EF9012',
      chassisLast5: MOCK_TEST_VEHICLES.DL01EF9012.chassisLast5,
      engineLast5: 'R5T4Y',
      makerModel: 'Tata Nexon EV',
      fuelType: 'ELECTRIC',
      registrationDate: '2023-01-10',
      puc: {
        isValid: true,
        validUpto: isoDaysFromNow(3),
        daysRemaining: 3,
        pucNumber: 'DL-PUC-000111',
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(120),
        companyName: 'HDFC Ergo',
        policyNumber: 'HE-POL-998877',
      },
      fitness: { validUpto: isoDaysFromNow(300) },
      fastagStatus: 'ACTIVE',
      fastagBank: 'SBI',
    },
    challans: [
      {
        challanNumber: 'DL01EF9012PK001',
        amount: 500,
        violationDate: isoDaysFromNow(-8),
        violationType: 'Parking',
        location: 'Connaught Place, New Delhi',
        status: 'UNPAID',
      },
    ],
  },
};

function refreshComputedFields(
  vehicle: StandardVehicleCompliance,
): StandardVehicleCompliance {
  const pucDays = daysRemainingFromIso(vehicle.puc.validUpto);
  const insValid = vehicle.insurance.validUpto
    ? new Date(vehicle.insurance.validUpto) > new Date()
    : false;

  return {
    ...vehicle,
    puc: {
      ...vehicle.puc,
      daysRemaining: pucDays,
      isValid: pucDays > 0,
    },
    insurance: {
      ...vehicle.insurance,
      isValid: insValid,
    },
  };
}

/** Simple string hash → stable pseudo-random ints for non-fixture plates. */
function hashPlate(regNumber: string): number {
  let h = 2166136261;
  for (let i = 0; i < regNumber.length; i++) {
    h ^= regNumber.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomFixture(regNumber: string): FixtureBundle {
  const h = hashPlate(regNumber);
  const pucDays = 30 + (h % 150);
  const insDays = 60 + ((h >>> 8) % 200);
  const fuels: FuelType[] = ['PETROL', 'DIESEL', 'CNG', 'ELECTRIC', 'HYBRID'];
  const models = [
    'Honda City',
    'Toyota Innova',
    'Mahindra XUV700',
    'Kia Seltos',
    'Skoda Kushaq',
  ];
  const fuelType = fuels[h % fuels.length]!;
  const makerModel = models[(h >>> 4) % models.length]!;
  const chassisLast5 = `X${(h % 90000).toString().padStart(4, '0')}`.slice(0, 5);
  const engineLast5 = `E${((h >>> 3) % 90000).toString().padStart(4, '0')}`.slice(
    0,
    5,
  );

  const challanCount = h % 3 === 0 ? 1 : 0;
  const challans: ChallanItem[] = challanCount
    ? [
        {
          challanNumber: `${regNumber}RND001`,
          amount: 500 + (h % 5) * 100,
          violationDate: isoDaysFromNow(-((h % 20) + 1)),
          violationType: 'Traffic Violation',
          location: 'Mock City ANPR Zone',
          status: 'UNPAID',
        },
      ]
    : [];

  return {
    vehicle: {
      regNumber,
      chassisLast5,
      engineLast5,
      makerModel,
      fuelType,
      registrationDate: '2020-01-01',
      puc: {
        isValid: true,
        validUpto: isoDaysFromNow(pucDays),
        daysRemaining: pucDays,
        pucNumber: `MOCK-PUC-${(h % 999999).toString().padStart(6, '0')}`,
      },
      insurance: {
        isValid: true,
        validUpto: isoDaysFromNow(insDays),
        companyName: 'Mock Insurance Co.',
        policyNumber: `MOCK-POL-${(h % 999999).toString().padStart(6, '0')}`,
      },
      fitness: { validUpto: isoDaysFromNow(365) },
      fastagStatus: 'ACTIVE',
      fastagBank: 'Mock Bank',
    },
    challans,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockVehicleProvider implements IVehicleDataProvider {
  async getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance> {
    await delay(40);
    const fixture = FIXTURES[regNumber] ?? randomFixture(regNumber);
    const vehicle = refreshComputedFields(structuredClone(fixture.vehicle));
    vehicle.challans = structuredClone(fixture.challans);
    return vehicle;
  }

  async getPendingChallans(
    regNumber: string,
    _chassisLast5?: string,
  ): Promise<ChallanItem[]> {
    await delay(30);
    const fixture = FIXTURES[regNumber] ?? randomFixture(regNumber);
    return structuredClone(fixture.challans);
  }
}
