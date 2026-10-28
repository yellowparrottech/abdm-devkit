/** Health information types a consent can cover (ABDM `hiTypes`). */
export const HI_TYPES = [
  "OPConsultation",
  "Prescription",
  "DiagnosticReport",
  "DischargeSummary",
  "ImmunizationRecord",
  "HealthDocumentRecord",
  "WellnessRecord",
  "Invoice",
] as const;
export type HiType = (typeof HI_TYPES)[number];

/** Consent purposes defined by ABDM. */
export const CONSENT_PURPOSES = {
  CAREMGT: "Care Management",
  BTG: "Break the Glass",
  PUBHLTH: "Public Health",
  HPAYMT: "Healthcare Payment",
  DSRCH: "Disease Specific Healthcare Research",
  PATRQT: "Self Requested",
} as const;
export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;

/** Inclusive date range as ISO 8601 timestamps. */
export interface DateRange {
  from: string;
  to: string;
}

/** NRCeS ABDM FHIR profile (IG 6.5.0) for each HI type. */
export const HI_TYPE_PROFILES: Record<HiType, string> = {
  OPConsultation: "OPConsultRecord",
  Prescription: "PrescriptionRecord",
  DiagnosticReport: "DiagnosticReportRecord",
  DischargeSummary: "DischargeSummaryRecord",
  ImmunizationRecord: "ImmunizationRecord",
  HealthDocumentRecord: "HealthDocumentRecord",
  WellnessRecord: "WellnessRecord",
  Invoice: "InvoiceRecord",
};

export const NRCES_PROFILE_BASE = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/";
