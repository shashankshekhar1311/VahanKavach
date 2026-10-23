/** Shared client types aligned with public.profiles / vehicles / challans. */

export type FuelType =
  | "PETROL"
  | "DIESEL"
  | "CNG"
  | "ELECTRIC"
  | "HYBRID"
  | "OTHER";

export type ChallanStatus =
  | "UNPAID"
  | "PAID_EXTERNALLY"
  | "PAID_VIA_APP"
  | "DISPUTED";

export type PucLevel = "green" | "amber" | "red";

export type NotificationChannel = "TELEGRAM" | "WHATSAPP" | "SIGNAL";

export interface Profile {
  id: string;
  phone_number: string | null;
  full_name: string | null;
  city: string | null;
  is_pro: boolean;
  preferred_channel: NotificationChannel;
  telegram_chat_id: string | null;
  telegram_link_token: string | null;
  signal_number: string | null;
}

/** Owner prepaid plan (~₹1/day/vehicle). */
export interface Subscription {
  id: string;
  user_id: string;
  status: "trial" | "active" | "past_due" | "cancelled" | "expired";
  trial_ends_at: string | null;
  current_period_end: string | null;
  vehicle_qty: number;
  amount_paise_per_vehicle: number;
}

export interface VehicleEntitlement {
  vehicle_id: string;
  user_id: string;
  active_until: string;
  source: "trial" | "subscription" | "admin_grant";
}

export interface Vehicle {
  id: string;
  user_id: string;
  reg_number: string;
  /** Last 5 only — never full chassis/VIN. */
  chassis_last_5: string | null;
  /** Last 5 only — never full engine number. */
  engine_last_5: string | null;
  maker_model: string | null;
  fuel_type: FuelType | null;
  puc_expiry_date: string | null;
  insurance_expiry_date: string | null;
  fitness_expiry_date: string | null;
  fastag_status: string | null;
  fastag_bank: string | null;
  last_polled_at: string | null;
}

/** DPDP consent audit row (user-readable). */
export interface ConsentAuditLog {
  id: string;
  user_id: string;
  vehicle_id: string;
  purpose: string;
  consent_text_version: string;
  ip_address: string | null;
  user_agent: string | null;
  granted_at: string;
}

export interface Challan {
  id: string;
  vehicle_id: string;
  challan_number: string;
  amount: number;
  violation_date: string | null;
  violation_type: string | null;
  location: string | null;
  evidence_url: string | null;
  status: ChallanStatus;
  payment_ref: string | null;
}

export interface VehicleWithChallans extends Vehicle {
  challans: Challan[];
}

export interface SyncVehicleApiResponse {
  success: boolean;
  data?: {
    source: "CACHE" | "UPSTREAM";
    vehicle: {
      regNumber: string;
      makerModel: string;
      fuelType: FuelType;
      puc: {
        isValid: boolean;
        validUpto: string | null;
        daysRemaining: number;
      };
      insurance: {
        isValid: boolean;
        validUpto: string | null;
      };
      fitness: {
        validUpto: string | null;
      };
    };
    challans: Array<{
      challanNumber: string;
      amount: number;
      violationDate: string;
      violationType: string;
      location: string;
      status: string;
      evidenceUrl?: string;
    }>;
    compliance: {
      isPucExpired: boolean;
      isInsuranceExpired: boolean;
      isFitnessExpired: boolean;
      pendingChallanCount: number;
      totalChallanAmount: number;
    };
  };
  error?: string;
}
