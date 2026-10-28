import type { DateRange, HiType } from "@yellowparrottech/abdm-core";
import { buildDocumentBundle, type FhirResource } from "@yellowparrottech/abdm-fhir";
import { digits, pick, seededRandom } from "./random.js";

export interface SyntheticRecord {
  hiType: HiType;
  careContextReference: string;
  /** A FHIR document Bundle. Shaped after the NRCeS profiles but not yet validated against them. */
  bundle: Record<string, unknown>;
}

export const SYNTHETIC_TAG = { system: "https://github.com/yellowparrottech/abdm-devkit", code: "synthetic", display: "Synthetic test data" };

// Plain-text clinical content only: no SNOMED CT or LOINC codes until terminology licensing is settled.
const CONTENT: Record<HiType, { title: string; resource: (r: () => number) => Record<string, unknown> }> = {
  OPConsultation: {
    title: "OP consultation",
    resource: (r) => ({ resourceType: "Condition", code: { text: pick(r, ["Seasonal allergic rhinitis", "Mild hypertension", "Viral fever"]) } }),
  },
  Prescription: {
    title: "Prescription",
    resource: (r) => ({
      resourceType: "MedicationRequest",
      status: "active",
      intent: "order",
      medicationCodeableConcept: { text: pick(r, ["Paracetamol 500 mg tablet", "Cetirizine 10 mg tablet", "Amlodipine 5 mg tablet"]) },
      dosageInstruction: [{ text: "One tablet twice a day for 5 days" }],
    }),
  },
  DiagnosticReport: {
    title: "Diagnostic report",
    resource: (r) => ({
      resourceType: "DiagnosticReport",
      status: "final",
      code: { text: pick(r, ["Complete blood count", "Lipid profile", "Fasting blood glucose"]) },
      conclusion: "Values within reference range",
    }),
  },
  DischargeSummary: { title: "Discharge summary", resource: () => ({ resourceType: "Condition", code: { text: "Uncomplicated appendicitis, treated" } }) },
  ImmunizationRecord: { title: "Immunization record", resource: () => ({ resourceType: "Immunization", status: "completed", vaccineCode: { text: "Tetanus toxoid" } }) },
  HealthDocumentRecord: { title: "Health document", resource: () => ({ resourceType: "DocumentReference", status: "current", description: "Scanned referral letter" }) },
  WellnessRecord: { title: "Wellness record", resource: () => ({ resourceType: "Observation", status: "final", code: { text: "Body weight" }, valueQuantity: { value: 68, unit: "kg" } }) },
  Invoice: { title: "Invoice", resource: () => ({ resourceType: "Invoice", status: "issued", totalNet: { value: 750, currency: "INR" } }) },
};

/** One synthetic record per requested HI type for a patient, dated inside the range. Reproducible from the inputs. */
export function syntheticRecords(abhaAddress: string, hiTypes: readonly HiType[], dateRange: DateRange): SyntheticRecord[] {
  const random = seededRandom(hash(`${abhaAddress}|${hiTypes.join(",")}|${dateRange.from}|${dateRange.to}`));
  const from = Date.parse(dateRange.from);
  const to = Date.parse(dateRange.to);
  const newId = () => `${digits(random, 8)}-${digits(random, 4)}-4${digits(random, 3)}-8${digits(random, 3)}-${digits(random, 12)}`;
  return hiTypes.map((hiType) => {
    const date = new Date(from + Math.floor(random() * (to - from + 1))).toISOString();
    const { title, resource } = CONTENT[hiType];
    return {
      hiType,
      careContextReference: `CC-${digits(random, 6)}`,
      bundle: buildDocumentBundle(
        {
          hiType,
          patient: { abhaAddress },
          practitioner: { name: "Dr Synthetic Example" },
          date,
          title: `${title} (synthetic)`,
          resources: [resource(random) as FhirResource],
          tags: [SYNTHETIC_TAG],
        },
        newId,
      ),
    };
  });
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
