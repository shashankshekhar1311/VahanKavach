import type {
  ChallanItem,
  ComplianceFlags,
  FuelType,
  StandardVehicleCompliance,
} from './types.ts';
import { toProviderChallanStatus } from './types.ts';

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function isCacheFresh(lastPolledAt: string | null | undefined): boolean {
  if (!lastPolledAt) return false;
  const polled = new Date(lastPolledAt).getTime();
  if (Number.isNaN(polled)) return false;
  return Date.now() - polled < CACHE_TTL_MS;
}

export function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function computeCompliance(
  vehicle: StandardVehicleCompliance,
  challans: ChallanItem[],
): ComplianceFlags {
  const unpaid = challans.filter((c) => c.status === 'UNPAID');
  const now = new Date();

  const fitnessExpired = vehicle.fitness.validUpto
    ? new Date(vehicle.fitness.validUpto) < now
    : false;

  return {
    isPucExpired: !vehicle.puc.isValid,
    isInsuranceExpired: !vehicle.insurance.isValid,
    isFitnessExpired: fitnessExpired,
    pendingChallanCount: unpaid.length,
    totalChallanAmount: unpaid.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
  };
}

/** DB vehicle row shape used when serving cached responses. */
export interface DbVehicleRow {
  id: string;
  reg_number: string;
  chassis_last_5: string | null;
  maker_model: string | null;
  fuel_type: FuelType | null;
  puc_expiry_date: string | null;
  insurance_expiry_date: string | null;
  fitness_expiry_date: string | null;
  fastag_status: string | null;
  fastag_bank: string | null;
  last_polled_at: string | null;
}

export interface DbChallanRow {
  challan_number: string;
  amount: number | string;
  violation_date: string | null;
  violation_type: string | null;
  location: string | null;
  evidence_url: string | null;
  status: string;
}

export function vehicleFromDbRow(row: DbVehicleRow): StandardVehicleCompliance {
  const now = new Date();
  const pucUpto = row.puc_expiry_date
    ? new Date(`${row.puc_expiry_date}T23:59:59.999Z`)
    : null;
  const pucDays = pucUpto
    ? Math.ceil((pucUpto.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const insuranceUpto = row.insurance_expiry_date
    ? new Date(`${row.insurance_expiry_date}T23:59:59.999Z`)
    : null;

  return {
    regNumber: row.reg_number,
    chassisLast5: row.chassis_last_5 ?? undefined,
    makerModel: row.maker_model ?? '',
    fuelType: row.fuel_type ?? 'OTHER',
    registrationDate: '',
    puc: {
      isValid: pucDays > 0,
      validUpto: pucUpto ? pucUpto.toISOString() : null,
      daysRemaining: Math.max(0, pucDays),
    },
    insurance: {
      isValid: insuranceUpto ? insuranceUpto > now : false,
      validUpto: insuranceUpto ? insuranceUpto.toISOString() : null,
      companyName: null,
    },
    fitness: {
      validUpto: row.fitness_expiry_date
        ? new Date(`${row.fitness_expiry_date}T23:59:59.999Z`).toISOString()
        : null,
    },
    fastagStatus: row.fastag_status,
    fastagBank: row.fastag_bank,
  };
}

export function challansFromDbRows(rows: DbChallanRow[]): ChallanItem[] {
  return rows.map((row) => ({
    challanNumber: row.challan_number,
    amount: Number(row.amount) || 0,
    violationDate: row.violation_date ?? new Date(0).toISOString(),
    violationType: row.violation_type ?? 'Traffic Violation',
    location: row.location ?? 'Unknown Location',
    status: toProviderChallanStatus(row.status),
    evidenceUrl: row.evidence_url ?? undefined,
  }));
}
