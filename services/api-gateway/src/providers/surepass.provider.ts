import axios, { AxiosInstance } from 'axios';
import { IVehicleDataProvider, StandardVehicleCompliance, ChallanItem } from '../types/vehicle';

export class SurepassProvider implements IVehicleDataProvider {
  private http: AxiosInstance;

  constructor() {
    const apiKey = process.env.SUREPASS_API_TOKEN;
    if (!apiKey) throw new Error('SUREPASS_API_TOKEN is missing in environment variables.');

    this.http = axios.create({
      baseURL: process.env.SUREPASS_BASE_URL || 'https://kyc-api.surepass.io/api/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  async getVehicleDetails(regNumber: string): Promise<StandardVehicleCompliance> {
    const response = await this.http.post('/rc/rc-full', {
      id_number: regNumber.toUpperCase().trim(),
    });

    const data = response.data?.data;
    if (!data) throw new Error('Failed to retrieve vehicle details from upstream provider.');

    const pucDate = data.pucc_upto ? new Date(data.pucc_upto) : null;
    const now = new Date();
    const daysRemaining = pucDate ? Math.ceil((pucDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

    return {
      regNumber: data.rc_number || regNumber,
      chassisLast5: data.chasi_no ? data.chasi_no.slice(-5) : undefined,
      engineLast5: data.eng_no ? data.eng_no.slice(-5) : undefined,
      makerModel: `${data.maker_description || ''} ${data.maker_model || ''}`.trim(),
      fuelType: this.normalizeFuel(data.fuel_type),
      registrationDate: data.regn_dt || '',
      puc: {
        isValid: daysRemaining > 0,
        validUpto: pucDate ? pucDate.toISOString() : null,
        daysRemaining: Math.max(0, daysRemaining),
        pucNumber: data.pucc_no,
      },
      insurance: {
        isValid: data.insurance_upto ? new Date(data.insurance_upto) > now : false,
        validUpto: data.insurance_upto ? new Date(data.insurance_upto).toISOString() : null,
        companyName: data.insurance_company || null,
        policyNumber: data.insurance_policy_no,
      },
      fitness: {
        validUpto: data.fit_dt ? new Date(data.fit_dt).toISOString() : null,
      },
    };
  }

  async getPendingChallans(regNumber: string, chassisLast5?: string): Promise<ChallanItem[]> {
    const response = await this.http.post('/challan/challan-details', {
      vehicle_number: regNumber.toUpperCase().trim(),
      chassis_number: chassisLast5,
    });

    const rawChallans = response.data?.data?.challans || [];
    return rawChallans.map((c: any) => ({
      challanNumber: c.challan_number,
      amount: Number(c.amount) || 0,
      violationDate: new Date(c.challan_date).toISOString(),
      violationType: c.offense_name || 'Traffic Violation',
      location: c.challan_location || 'Unknown Location',
      status: c.status?.toUpperCase() === 'PAID' ? 'PAID' : 'UNPAID',
      evidenceUrl: c.image_url || undefined,
      challanPdfUrl: c.pdf_url || undefined,
    }));
  }

  private normalizeFuel(fuel: string): StandardVehicleCompliance['fuelType'] {
    const f = (fuel || '').toUpperCase();
    if (f.includes('PETROL')) return 'PETROL';
    if (f.includes('DIESEL')) return 'DIESEL';
    if (f.includes('CNG')) return 'CNG';
    if (f.includes('ELEC')) return 'ELECTRIC';
    if (f.includes('HYBRID')) return 'HYBRID';
    return 'OTHER';
  }
}