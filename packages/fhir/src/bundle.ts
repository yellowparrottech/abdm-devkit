import { HI_TYPE_PROFILES, NRCES_PROFILE_BASE, type HiType } from "@yellowparrottech/abdm-core";

export type FhirResource = Record<string, unknown> & { resourceType: string };

export interface Coding {
  system: string;
  code: string;
  display?: string;
}

export interface DocumentInput {
  hiType: HiType;
  patient: { abhaAddress: string; name?: string };
  practitioner: { name: string };
  /** When the document was written, ISO 8601. */
  date: string;
  title?: string;
  /** Clinical resources for the document's one section. Each gets `subject` set to the patient. */
  resources: FhirResource[];
  /** Added to `Bundle.meta.tag`, for example to mark synthetic data. */
  tags?: Coding[];
}

const TITLES: Record<HiType, string> = {
  OPConsultation: "OP consultation",
  Prescription: "Prescription",
  DiagnosticReport: "Diagnostic report",
  DischargeSummary: "Discharge summary",
  ImmunizationRecord: "Immunization record",
  HealthDocumentRecord: "Health document",
  WellnessRecord: "Wellness record",
  Invoice: "Invoice",
};

/**
 * A FHIR document Bundle shaped after the NRCeS ABDM profiles: a Composition declaring the profile
 * for the HI type, then the Patient, the author and the clinical resources, linked by `urn:uuid` references.
 */
export function buildDocumentBundle(input: DocumentInput, newId: () => string = () => crypto.randomUUID()): FhirResource {
  const [bundleId, compositionId, patientId, practitionerId] = [newId(), newId(), newId(), newId()];
  const resourceIds = input.resources.map(() => newId());
  const ref = (id: string) => ({ reference: `urn:uuid:${id}` });
  const title = input.title ?? TITLES[input.hiType];

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { profile: [`${NRCES_PROFILE_BASE}DocumentBundle`], ...(input.tags?.length ? { tag: input.tags } : {}) },
    identifier: { system: "urn:ietf:rfc:3986", value: `urn:uuid:${bundleId}` },
    type: "document",
    timestamp: input.date,
    entry: [
      {
        fullUrl: `urn:uuid:${compositionId}`,
        resource: {
          resourceType: "Composition",
          meta: { profile: [`${NRCES_PROFILE_BASE}${HI_TYPE_PROFILES[input.hiType]}`] },
          status: "final",
          type: { text: TITLES[input.hiType] },
          subject: ref(patientId),
          date: input.date,
          author: [ref(practitionerId)],
          title,
          section: [{ title, entry: resourceIds.map(ref) }],
        },
      },
      {
        fullUrl: `urn:uuid:${patientId}`,
        resource: {
          resourceType: "Patient",
          identifier: [{ system: "https://healthid.abdm.gov.in", value: input.patient.abhaAddress }],
          ...(input.patient.name ? { name: [{ text: input.patient.name }] } : {}),
        },
      },
      { fullUrl: `urn:uuid:${practitionerId}`, resource: { resourceType: "Practitioner", name: [{ text: input.practitioner.name }] } },
      ...input.resources.map((resource, i) => ({ fullUrl: `urn:uuid:${resourceIds[i]}`, resource: { ...resource, subject: ref(patientId) } })),
    ],
  };
}
