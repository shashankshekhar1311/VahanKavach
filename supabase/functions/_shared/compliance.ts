import type {
  ChallanItem,
  ComplianceFlags,
  FuelType,
  StandardVehicleCompliance,
} from './types.ts';
import { toProviderChallanStatus } from './types.ts';
import { linkedContactCompliance } from './providers/contact-compliance.ts';

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (legacy default)

export function isCacheFresh(
  lastPolledAt: string | null | undefined,
  ttlMs: number = CACHE_TTL_MS,
): boolean {
  if (!lastPolledAt) return false;
  const polled = new Date(lastPolledAt).getTime();
  if (Number.isNaN(polled)) return false;
  return Date.now() - polled < ttlMs;
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
  user_id?: string | null;
  reg_number: string;
  chassis_last_5: string | null;
  engine_last_5?: string | null;
  maker_model: string | null;
  fuel_type: FuelType | null;
  puc_expiry_date: string | null;
  insurance_expiry_date: string | null;
  fitness_expiry_date: string | null;
  fastag_status: string | null;
  fastag_bank: string | null;
  last_polled_at: string | null;
  cached_until?: string | null;
  is_verified_owner?: boolean | null;
  rc_mobile_linked?: boolean | null;
  rc_aadhaar_linked?: boolean | null;
  rc_contact_warning?: boolean | null;
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
    engineLast5: row.engine_last_5 ?? undefined,
    makerModel: row.maker_model ?? '',
    fuelType: row.fuel_type ?? 'OTHER',
    registrationDate: '',

    puc: {
      isValid: pucDays > 0,
      validUpto: pucUpto ? pucUpto.toISOString() : null,
      daysRemaining: pucDays,
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
    contactCompliance: linkedContactCompliance({
      mobileLinked: row.rc_mobile_linked !== false,
      aadhaarLinked: row.rc_aadhaar_linked !== false,
      warningNotice:
        row.rc_contact_warning
          ? 'Mobile and Aadhaar not seeded in VAHAN database. Rs 1,000 fine risk.'
          : undefined,
    }),
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

export type VehicleAuditStatus = 
  | 'ACTIVE' 
  | 'EXPIRED_RC' 
  | 'UNINDEXED_OR_NOT_FOUND' 
  | 'INVALID_SYNTAX';

export interface VehicleStatusVerdict {
  status: VehicleAuditStatus;
  isCompliant: boolean;
  headline: string;
  actionMessage: string;
}

export function evaluateVehicleStatus(
  apiData: Record<string, any> | null,
  subCode?: string
): VehicleStatusVerdict {
  // 1. Not found on central VAHAN
  if (subCode === 'INVALID_RC_NUMBER' || !apiData) {
    return {
      status: 'UNINDEXED_OR_NOT_FOUND',
      isCompliant: false,
      headline: 'Vehicle Record Not Digitized on VAHAN 4.0',
      actionMessage: 'Verify plate spelling. If registered pre-2015, an RTO Backlog Entry is required.',
    };
  }

  // 2. Check Fitness / Registration Expiry Date
  const fitDateStr = apiData.fit_up_to || apiData.rc_expiry_date;
  const isFitnessExpired = fitDateStr ? new Date(fitDateStr).getTime() < Date.now() : false;
  const isRcInactive = apiData.rc_status && apiData.rc_status.toUpperCase() !== 'ACTIVE';

  if (isFitnessExpired || isRcInactive) {
    return {
      status: 'EXPIRED_RC',
      isCompliant: false,
      headline: 'Registration Certificate (RC) / Fitness Expired',
      actionMessage: `Fitness expired on ${fitDateStr || 'N/A'}. Apply for renewal at your home RTO to avoid Section 192 impoundment.`,
    };
  }

  // 3. Fully Active on VAHAN 4.0
  return {
    status: 'ACTIVE',
    isCompliant: true,
    headline: 'Active VAHAN Registration',
    actionMessage: 'Vehicle registration is active and road-legal on the central National Register.',
  };
}