/**
 * Setu RC + Bharat Connect Challan adapter.
 *
 * Sandbox (SETU_SANDBOX / VEHICLE_PROVIDER=SETU_SANDBOX):
 *   SETU_BASE_URL     — default https://sandbox.setu.co/api/v1
 *   SETU_CLIENT_ID    — sent as x-client-id
 *   SETU_CLIENT_SECRET — sent as x-client-secret
 *
 * Production (SETU_PROD) may use the same header auth against a prod base URL,
 * or OAuth token exchange when SETU_AUTH_MODE=oauth.
 */

import type {
  ChallanItem,
  FuelType,
  IVehicleDataProvider,
  StandardVehicleCompliance,
} from './types.ts';
import { ProviderHttpError } from './surepass.provider.ts';
import { maskSecrets, safeLog, withRetryAndCircuit } from './resilience.ts';

const SANDBOX_BASE_URL = 'https://sandbox.setu.co/api/v1';
const PROD_BASE_URL = 'https://dg.setu.co/api';
const DEFAULT_TIMEOUT_MS = 10_000;

export class SetuProvider implements IVehicleDataProvider {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly authMode: 'headers' | 'oauth';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(options?: {
    clientId?: string;
    clientSecret?: string;
    baseUrl?: string;
    timeoutMs?: number;
    authMode?: 'headers' | 'oauth';
    sandbox?: boolean;
  }) {
    const clientId = options?.clientId ?? Deno.env.get('SETU_CLIENT_ID')?.trim();
    const clientSecret =
      options?.clientSecret ?? Deno.env.get('SETU_CLIENT_SECRET')?.trim();
    if (!clientId || !clientSecret) {
      throw new Error(
        'SETU_CLIENT_ID / SETU_CLIENT_SECRET missing for Setu provider.',
      );
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    const providerEnv = (
      Deno.env.get('VEHICLE_PROVIDER') ??
      Deno.env.get('VEHICLE_PROVIDER_MODE') ??
      ''
    ).toUpperCase();
    const sandbox =
      options?.sandbox ??
      (providerEnv.includes('SANDBOX') ||
        (Deno.env.get('SETU_BASE_URL') ?? '').includes('sandbox.setu.co'));

    this.baseUrl =
      options?.baseUrl ??
      Deno.env.get('SETU_BASE_URL')?.trim() ??
      (sandbox ? SANDBOX_BASE_URL : PROD_BASE_URL);

    this.timeoutMs =
      options?.timeoutMs ??
      Number(Deno.env.get('SETU_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);

    const envAuth = (Deno.env.get('SETU_AUTH_MODE') ?? '').toLowerCase();
    this.authMode =
      options?.authMode ??
      (envAuth === 'oauth' ? 'oauth' : 'headers');
  }

  async getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance> {
    return withRetryAndCircuit('setu', async () => {
      const json = await this.requestJson<{
        data?: Record<string, unknown>;
      }>('/vehicle/rc', { registrationNumber: regNumber });

      const data = json.data ?? {};
      const chassis = String(data.chassisNumber ?? data.chasi_no ?? '');
      const engine = String(data.engineNumber ?? data.eng_no ?? '');
      const pucUpto = data.pucValidUpto
        ? String(data.pucValidUpto)
        : data.pucc_upto
        ? String(data.pucc_upto)
        : null;
      const now = new Date();
      const pucDate = pucUpto ? new Date(pucUpto) : null;
      const daysRemaining = pucDate
        ? Math.ceil((pucDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const insuranceUpto = data.insuranceValidUpto
        ? String(data.insuranceValidUpto)
        : data.insurance_upto
        ? String(data.insurance_upto)
        : null;
      const insuranceDate = insuranceUpto ? new Date(insuranceUpto) : null;

      return {
        regNumber: String(data.registrationNumber ?? data.rc_number ?? regNumber),
        chassisLast5: lastFive(chassis),
        engineLast5: lastFive(engine),
        makerModel: `${data.maker ?? data.maker_description ?? ''} ${
          data.model ?? data.maker_model ?? ''
        }`.trim() || 'Unknown',
        fuelType: normalizeFuel(String(data.fuelType ?? data.fuel_type ?? '')),
        registrationDate: String(data.registrationDate ?? data.regn_dt ?? ''),
        puc: {
          isValid: daysRemaining > 0,
          validUpto: pucDate && !Number.isNaN(pucDate.getTime())
            ? pucDate.toISOString()
            : null,
          daysRemaining,
        },
        insurance: {
          isValid: insuranceDate ? insuranceDate > now : false,
          validUpto:
            insuranceDate && !Number.isNaN(insuranceDate.getTime())
              ? insuranceDate.toISOString()
              : null,
          companyName: data.insuranceCompany
            ? String(data.insuranceCompany)
            : data.insurance_comp
            ? String(data.insurance_comp)
            : null,
        },
        fitness: {
          validUpto: data.fitnessValidUpto
            ? new Date(String(data.fitnessValidUpto)).toISOString()
            : data.fit_upto
            ? new Date(String(data.fit_upto)).toISOString()
            : null,
        },
      };
    });
  }

  async getPendingChallans(
    regNumber: string,
    _chassisLast5?: string,
  ): Promise<ChallanItem[]> {
    return withRetryAndCircuit('setu', async () => {
      // Bharat Connect / challan discovery on Setu sandbox & prod.
      const json = await this.requestJson<{
        data?: {
          challans?: Array<Record<string, unknown>>;
          data?: Array<Record<string, unknown>>;
        };
      }>('/vehicle/challans', { registrationNumber: regNumber });

      const raw =
        json.data?.challans ??
        json.data?.data ??
        [];

      return raw
        .filter((c) => c.challanNumber || c.challan_number || c.challanNo)
        .map((c) => {
          const statusUpper = String(c.status ?? '').toUpperCase();
          let status: ChallanItem['status'] = 'UNPAID';
          if (statusUpper === 'PAID') status = 'PAID';
          else if (statusUpper === 'DISPUTED') status = 'DISPUTED';
          return {
            challanNumber: String(
              c.challanNumber ?? c.challan_number ?? c.challanNo,
            ),
            amount: Number(c.amount ?? c.fine_amount ?? 0) || 0,
            violationDate: String(
              c.challanDate ??
                c.challan_date ??
                c.offenseDate ??
                new Date().toISOString(),
            ),
            violationType: String(
              c.offense ??
                c.offense_name ??
                c.violationType ??
                'Traffic Violation',
            ),
            location: String(
              c.location ?? c.challan_location ?? 'Unknown Location',
            ),
            status,
            evidenceUrl: c.evidenceUrl
              ? String(c.evidenceUrl)
              : c.evidence_url
              ? String(c.evidence_url)
              : undefined,
          };
        });
    });
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.authMode === 'oauth') {
      const token = await this.getAccessToken();
      return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    }

    return {
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          clientID: this.clientId,
          secret: this.clientSecret,
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        safeLog('setu token error', {
          status: res.status,
          body: maskSecrets(text.slice(0, 200)),
        });
        throw new ProviderHttpError(
          `Setu auth failed (${res.status})`,
          502,
          res.status,
        );
      }
      const json = JSON.parse(text) as {
        access_token?: string;
        accessToken?: string;
        expires_in?: number;
      };
      const token = json.access_token ?? json.accessToken;
      if (!token) {
        throw new ProviderHttpError('Setu auth response missing access token', 502);
      }
      this.accessToken = token;
      this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
      return token;
    } catch (err) {
      if (err instanceof ProviderHttpError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderHttpError('Setu auth timed out', 504, 504);
      }
      throw new ProviderHttpError(
        `Setu auth network error: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestJson<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = await this.authHeaders();
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        safeLog('setu request failed', {
          path,
          status: res.status,
          body: maskSecrets(text.slice(0, 200)),
        });
        throw new ProviderHttpError(
          `Setu request failed (${res.status})`,
          res.status === 504 ? 504 : 502,
          res.status,
        );
      }
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof ProviderHttpError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderHttpError(
          `Setu request timed out after ${this.timeoutMs}ms.`,
          504,
          504,
        );
      }
      throw new ProviderHttpError(
        `Setu network error: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function lastFive(raw: string): string | undefined {
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 5) return undefined;
  return cleaned.slice(-5);
}

function normalizeFuel(fuel: string): FuelType {
  const f = fuel.toUpperCase();
  if (f.includes('PETROL')) return 'PETROL';
  if (f.includes('DIESEL')) return 'DIESEL';
  if (f.includes('CNG')) return 'CNG';
  if (f.includes('ELEC')) return 'ELECTRIC';
  if (f.includes('HYBRID')) return 'HYBRID';
  return 'OTHER';
}
