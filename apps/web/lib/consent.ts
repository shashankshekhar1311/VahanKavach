/** DPDP consent copy + audit constants (keep in sync with UI checkbox). */

export const CONSENT_PURPOSE = "VAHAN_RC_AND_CHALLAN_MONITORING" as const;
export const CONSENT_TEXT_VERSION = "v1.0_2026" as const;

export function buildVehicleConsentLabel(regDisplay: string): string {
  const plate = regDisplay.trim() || "[REG_NO]";
  return `I hereby give explicit consent to VahanKavach to fetch and periodically monitor the registration, PUC, insurance, and e-challan status of vehicle ${plate} on my behalf. I understand I can revoke this consent anytime by removing the vehicle.`;
}
