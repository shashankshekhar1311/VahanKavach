/**
 * Deepvue VAHAN / challan adapter.
 *
 * Critical billing rule: HTTP 200 alone is NOT success. Only treat lookups as
 * billable when sub_code === "SUCCESS" and data is present.
 *
 * Env:
 *   DEEPVUE_CLIENT_ID
 *   DEEPVUE_API_KEY
 *   DEEPVUE_BASE_URL (optional, default https://api.deepvue.ai/v1)
 */

import type {
  ChallanItem,
  FuelType,
  IVehicleDataProvider,
  StandardVehicleCompliance,
} from '../types.ts';
import { ProviderHttpError } from './surepass.provider.ts';

const DEFAULT_BASE_URL = 'https://api.deepvue.ai/v1';

const NON_SUCCESS_RC_CODES = new Set([
  'INVALID_RC_NUMBER',
  'NO_MATCHING_RECORD',
  'NO_RECORD_FOUND',
  'RECORD_NOT_FOUND',
]);

function cleanPlate(regNumber: string): string {
  return regNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function lastFiveAlnum(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const cleaned = String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 5) return undefined;
  const last5 = cleaned.slice(-5);
  return /^[A-Z0-9]{5}$/.test(last5) ? last5 : undefined;
}

function toIsoOrNull(raw: unknown): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeFuel(raw: unknown): FuelType {
  const v = String(raw ?? '').toUpperCase();
  if (v.includes('DIESEL')) return 'DIESEL';
  if (v.includes('CNG')) return 'CNG';
  if (v.includes('ELECTRIC') || v === 'EV') return 'ELECTRIC';
  if (v.includes('HYBRID')) return 'HYBRID';
  if (v.includes('PETROL') || v.includes('MOTOR SPIRIT')) return 'PETROL';
  return 'OTHER';
}

export class DeepvueProvider implements IVehicleDataProvider {
  private readonly clientId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.clientId = Deno.env.get('DEEPVUE_CLIENT_ID')?.trim() ?? '';
    this.apiKey = Deno.env.get('DEEPVUE_API_KEY')?.trim() ?? '';
    this.baseUrl =
      Deno.env.get('DEEPVUE_BASE_URL')?.trim() || DEFAULT_BASE_URL;

    if (!this.clientId || !this.apiKey) {
      throw new Error('DEEPVUE_CLIENT_ID / DEEPVUE_API_KEY missing in environment.');
    }
  }

  async getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance> {
    const plate = cleanPlate(regNumber);

    const res = await fetch(`${this.baseUrl}/verification/rc-advanced`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': this.clientId,
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({ vehicle_number: plate }),
    });

    if (!res.ok) {
      throw new ProviderHttpError(
        'Upstream RC provider unavailable. Please try again shortly.',
        res.status >= 500 ? 502 : 502,
        res.status,
      );
    }

    const json = (await res.json().catch(() => null)) as {
      sub_code?: string;
      message?: string;
      data?: Record<string, unknown> | null;
    } | null;

    if (!json) {
      throw new ProviderHttpError('Upstream RC provider returned invalid JSON.', 502);
    }

    const subCode = String(json.sub_code ?? '').toUpperCase();

    if (NON_SUCCESS_RC_CODES.has(subCode) || !json.data) {
      // Not billable — caller must NOT consume scan credits.
      throw new ProviderHttpError(
        'Vehicle registration not found in VAHAN records. Check the plate and try again.',
        404,
        res.status,
      );
    }

    if (subCode !== 'SUCCESS') {
      throw new ProviderHttpError(
        'Upstream RC verification failed. No credits were charged.',
        502,
        res.status,
      );
    }

    const d = json.data;
    const now = Date.now();
    const pucUpto = toIsoOrNull(d.pucc_upto);
    const insuranceUpto = toIsoOrNull(d.insurance_upto);
    const fitnessUpto = toIsoOrNull(d.fit_up_to ?? d.fitness_upto);
    const pucMs = pucUpto ? new Date(pucUpto).getTime() : NaN;
    const insMs = insuranceUpto ? new Date(insuranceUpto).getTime() : NaN;
    const pucDays = Number.isFinite(pucMs)
      ? Math.max(0, Math.ceil((pucMs - now) / (1000 * 60 * 60 * 24)))
      : 0;

    const maker = String(d.maker_description ?? '').trim();
    const model = String(d.maker_model ?? '').trim();
    const policyRaw = d.insurance_policy_number;
    const policyNumber =
      policyRaw && String(policyRaw) !== '00000'
        ? String(policyRaw)
        : undefined;

    const mobileRaw = d.mobile_number;
    const mobileLinked = Boolean(
      mobileRaw && !String(mobileRaw).startsWith('00000'),
    );

    return {
      regNumber: plate,
      chassisLast5: lastFiveAlnum(d.vehicle_chasi_number),
      engineLast5: lastFiveAlnum(d.vehicle_engine_number),
      makerModel: `${maker} ${model}`.trim() || 'UNKNOWN',
      fuelType: normalizeFuel(d.fuel_type),
      registrationDate: String(d.registration_date ?? ''),
      puc: {
        isValid: Number.isFinite(pucMs) && pucMs > now,
        validUpto: pucUpto,
        daysRemaining: pucDays,
        pucNumber: d.pucc_number ? String(d.pucc_number) : undefined,
      },
      insurance: {
        isValid: Number.isFinite(insMs) && insMs > now,
        validUpto: insuranceUpto,
        companyName: d.insurance_company
          ? String(d.insurance_company)
          : null,
        policyNumber,
      },
      fitness: {
        validUpto: fitnessUpto,
      },
      contactCompliance: {
        mobileLinked,
        aadhaarLinked: true,
      },
    };
  }

  async getPendingChallans(
    regNumber: string,
    _chassisLast5?: string,
  ): Promise<ChallanItem[]> {
    const plate = cleanPlate(regNumber);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/verification/rc-challan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'client-id': this.clientId,
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ vehicle_number: plate }),
      });
    } catch {
      // Challan fetch is best-effort after RC success — do not fail the whole sync.
      return [];
    }

    if (!res.ok) return [];

    const json = (await res.json().catch(() => null)) as {
      sub_code?: string;
      data?: {
        challan_details?: Record<string, unknown>[];
        challans?: Record<string, unknown>[];
      } | null;
    } | null;

    if (!json || String(json.sub_code ?? '').toUpperCase() !== 'SUCCESS' || !json.data) {
      return [];
    }

    const raw = json.data.challan_details ?? json.data.challans ?? [];
    if (!Array.isArray(raw)) return [];

    return raw
      .map((c) => this.mapChallan(c))
      .filter((c): c is ChallanItem => c !== null);
  }

  private mapChallan(c: Record<string, unknown>): ChallanItem | null {
    const challanNumber = String(
      c.challan_number ?? c.challanNumber ?? '',
    ).trim();
    if (!challanNumber) return null;

    const amount = Number(c.amount ?? c.challan_amount ?? 0);
    const statusRaw = String(c.status ?? c.challan_status ?? '').toUpperCase();
    const status: ChallanItem['status'] =
      statusRaw === 'PAID' ? 'PAID' : statusRaw === 'DISPUTED' ? 'DISPUTED' : 'UNPAID';

    const violationDateRaw = c.violation_date ?? c.challan_date;
    const violationDate = toIsoOrNull(violationDateRaw) ?? new Date().toISOString();

    return {
      challanNumber,
      amount: Number.isFinite(amount) ? amount : 0,
      violationDate,
      violationType: String(
        c.violation_type ?? c.challan_reason ?? 'Traffic Violation',
      ),
      location: String(
        c.location ?? c.challan_place ?? 'Traffic Jurisdiction',
      ),
      status,
      evidenceUrl: c.evidence_url || c.image_url
        ? String(c.evidence_url ?? c.image_url)
        : undefined,
    };
  }
}
