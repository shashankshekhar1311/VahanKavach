/**
 * Statutory / merchant onboarding constants.
 * Override via NEXT_PUBLIC_* for production legal entity details.
 */

export const LEGAL = {
  productName: "VahanKavach",
  companyLegalName:
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME?.trim() || "[Company Name]",
  supportEmail:
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@vahankavach.app",
  grievanceEmail:
    process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL?.trim() ||
    "grievance@vahankavach.app",

  grievanceOfficerName:
    process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME?.trim() ||
    "[Grievance Redressal Officer Name]",
  registeredAddress:
    process.env.NEXT_PUBLIC_REGISTERED_OFFICE_ADDRESS?.trim() ||
    "[Registered Office Address — Street, City, State, PIN, India]",
  businessHours:
    process.env.NEXT_PUBLIC_BUSINESS_HOURS?.trim() ||
    "Monday–Friday, 10:00–18:00 IST (excluding public holidays)",
  websiteUrl:
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://vahankavach.app",
  lastUpdated: "22 October 2026",
} as const;

export const DISCLAIMER_TEXT = `Disclaimer: ${LEGAL.productName} is an independent private platform operated by ${LEGAL.companyLegalName}. It is not affiliated with, authorized by, endorsed by, or in any way officially connected with the Ministry of Road Transport and Highways (MoRTH), Parivahan, or any State Traffic Police department. Vehicle and compliance data are fetched via authorized licensed third-party data providers.`;
