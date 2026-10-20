/**
 * Surepass VAHAN / E-Challan provider adapter.
 *
 * Env:
 *   SUREPASS_API_TOKEN  – Bearer token (required)
 *   SUREPASS_BASE_URL   – defaults to https://kyc-api.surepass.io/api/v1
 *   SUREPASS_TIMEOUT_MS – request timeout in ms (default 10000)
 */

import type {
  ChallanItem,
  FuelType,
  IVehicleDataProvider,
  StandardVehicleCompliance,
} from '../types.ts';

const DEFAULT_BASE_URL = 'https://kyc-api.surepass.io/api/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

interface SurepassRcPayload {
  rc_number?: string;
  chasi_no?: string;
  eng_no?: string;
  maker_description?: string;
  maker_model?: string;
  fuel_type?: string;
  regn_dt?: string;
  pucc_upto?: string;
  pucc_no?: string;
  insurance_upto?: string;
  insurance_company?: string;
  insurance_policy_no?: string;
  fit_dt?: string;
}

interface SurepassChallanRaw {
  challan_number?: string;
  amount?: string | number;
  challan_date?: string;
  offense_name?: string;
  challan_location?: string;
  status?: string;
  image_url?: string;
  pdf_url?: string;
}

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly upstreamStatus?: number;

  constructor(message: string, status = 502, upstreamStatus?: number) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

/** Last 5 alphanumeric chars, or undefined if not exactly 5 (DB CHECK). */
function lastFiveAlnum(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 5) return undefined;
  const last5 = cleaned.slice(-5);
  return /^[A-Z0-9]{5}$/.test(last5) ? last5 : undefined;
}

export class SurepassProvider implements IVehicleDataProvider {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;

  constructor(options?: {
    apiToken?: string;
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    const apiToken = options?.apiToken ?? Deno.env.get('SUREPASS_API_TOKEN');
    if (!apiToken) {
      throw new Error('SUREPASS_API_TOKEN is missing in environment variables.');
    }

    this.apiToken = apiToken;
    this.baseUrl =
      options?.baseUrl ??
      Deno.env.get('SUREPASS_BASE_URL') ??
      DEFAULT_BASE_URL;
    this.timeoutMs =
      options?.timeoutMs ??
      Number(Deno.env.get('SUREPASS_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  }

  async getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance> {
    const json = await this.postJson<{ data?: SurepassRcPayload }>(
      '/rc/rc-full',
      { id_number: regNumber },
    );

    const data = json.data;
    if (!data) {
      throw new ProviderHttpError(
        'Failed to retrieve vehicle details from upstream provider.',
        502,
      );
    }

    const now = new Date();
    const pucDate = data.pucc_upto ? new Date(data.pucc_upto) : null;
    const daysRemaining = pucDate
      ? Math.ceil((pucDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      regNumber: data.rc_number || regNumber,
      chassisLast5: lastFiveAlnum(data.chasi_no),
      engineLast5: lastFiveAlnum(data.eng_no),
      makerModel: `${data.maker_description || ''} ${data.maker_model || ''}`.trim(),
      fuelType: this.normalizeFuel(data.fuel_type),
      registrationDate: data.regn_dt || '',
      puc: {
        isValid: daysRemaining > 0,
        validUpto: pucDate && !Number.isNaN(pucDate.getTime())
          ? pucDate.toISOString()
          : null,
        daysRemaining: Math.max(0, daysRemaining),
        pucNumber: data.pucc_no,
      },
      insurance: {
        isValid: data.insurance_upto
          ? new Date(data.insurance_upto) > now
          : false,
        validUpto: data.insurance_upto
          ? new Date(data.insurance_upto).toISOString()
          : null,
        companyName: data.insurance_company || null,
        policyNumber: data.insurance_policy_no,
      },
      fitness: {
        validUpto: data.fit_dt ? new Date(data.fit_dt).toISOString() : null,
      },
    };
  }

  async getPendingChallans(
    regNumber: string,
    chassisLast5?: string,
  ): Promise<ChallanItem[]> {
    const json = await this.postJson<{
      data?: { challans?: SurepassChallanRaw[] };
    }>('/challan/challan-details', {
      vehicle_number: regNumber,
      chassis_number: chassisLast5,
    });

    const rawChallans = json.data?.challans ?? [];
    return rawChallans
      .filter((c) => Boolean(c.challan_number))
      .map((c) => this.mapChallan(c));
  }

  private mapChallan(c: SurepassChallanRaw): ChallanItem {
    const statusUpper = (c.status ?? '').toUpperCase();
    let status: ChallanItem['status'] = 'UNPAID';
    if (statusUpper === 'PAID') status = 'PAID';
    else if (statusUpper === 'DISPUTED') status = 'DISPUTED';

    const violationDate = c.challan_date
      ? new Date(c.challan_date)
      : new Date();

    return {
      challanNumber: String(c.challan_number),
      amount: Number(c.amount) || 0,
      violationDate: Number.isNaN(violationDate.getTime())
        ? new Date().toISOString()
        : violationDate.toISOString(),
      violationType: c.offense_name || 'Traffic Violation',
      location: c.challan_location || 'Unknown Location',
      status,
      evidenceUrl: c.image_url || undefined,
      challanPdfUrl: c.pdf_url || undefined,
    };
  }

  private normalizeFuel(fuel: string | undefined): FuelType {
    const f = (fuel || '').toUpperCase();
    if (f.includes('PETROL')) return 'PETROL';
    if (f.includes('DIESEL')) return 'DIESEL';
    if (f.includes('CNG')) return 'CNG';
    if (f.includes('ELEC')) return 'ELECTRIC';
    if (f.includes('HYBRID')) return 'HYBRID';
    return 'OTHER';
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ProviderHttpError(
          `Surepass request failed (${response.status}): ${text.slice(0, 200) || response.statusText}`,
          502,
          response.status,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof ProviderHttpError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderHttpError(
          `Surepass request timed out after ${this.timeoutMs}ms.`,
          504,
        );
      }
      throw new ProviderHttpError(
        `Surepass network error: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
