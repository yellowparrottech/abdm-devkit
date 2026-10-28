import { describe, expect, it } from "vitest";
import { buildDocumentBundle, validateDocumentBundle, type FhirResource } from "./index.js";

const prescription = () =>
  buildDocumentBundle({
    hiType: "Prescription",
    patient: { abhaAddress: "asha.rao1@sbx" },
    practitioner: { name: "Dr Example" },
    date: "2025-06-01T10:00:00.000Z",
    resources: [{ resourceType: "MedicationRequest", status: "active", intent: "order", medicationCodeableConcept: { text: "Paracetamol 500 mg tablet" } }],
  });

type Entry = { fullUrl: string; resource: FhirResource };
const entries = (b: FhirResource) => b.entry as Entry[];
const composition = (b: FhirResource) => entries(b)[0]!.resource as FhirResource & Record<string, unknown>;

describe("document bundles", () => {
  it("builds a bundle that passes structural validation", () => {
    expect(validateDocumentBundle(prescription())).toEqual({ valid: true, hiType: "Prescription", issues: [] });
  });

  it("declares the NRCeS profile for the HI type and links the patient", () => {
    const bundle = prescription();
    expect(composition(bundle).meta).toEqual({ profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord"] });
    const medication = entries(bundle)[3]!.resource;
    expect(medication.subject).toEqual(composition(bundle).subject);
  });

  it.each([
    ["not a bundle", () => ({ resourceType: "Patient" }), "Bundle"],
    ["a non-document bundle", (b: FhirResource) => ({ ...b, type: "collection" }), "Bundle.type"],
    ["a missing timestamp", (b: FhirResource) => ({ ...b, timestamp: "yesterday" }), "Bundle.timestamp"],
    ["no Composition first", (b: FhirResource) => ({ ...b, entry: entries(b).slice(1) }), "Bundle.entry[0].resource"],
    [
      "an unknown record profile",
      (b: FhirResource) => ({ ...b, entry: [{ ...entries(b)[0], resource: { ...composition(b), meta: { profile: ["http://example.org/Other"] } } }, ...entries(b).slice(1)] }),
      "Bundle.entry[0].resource.meta.profile",
    ],
    [
      "a subject that does not resolve",
      (b: FhirResource) => ({ ...b, entry: [{ ...entries(b)[0], resource: { ...composition(b), subject: { reference: "urn:uuid:missing" } } }, ...entries(b).slice(1)] }),
      "Bundle.entry[0].resource.subject",
    ],
    ["a section entry that does not resolve", (b: FhirResource) => ({ ...b, entry: entries(b).slice(0, 3) }), "Bundle.entry[0].resource.section[0].entry[0]"],
    ["duplicate fullUrls", (b: FhirResource) => ({ ...b, entry: [...entries(b), entries(b)[1]] }), "Bundle.entry[4].fullUrl"],
  ])("reports %s", (_, mutate, path) => {
    const report = validateDocumentBundle(mutate(prescription()));
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.path)).toContain(path);
  });

  it("warns, without failing, when the bundle omits the DocumentBundle profile", () => {
    const report = validateDocumentBundle({ ...prescription(), meta: {} });
    expect(report).toMatchObject({ valid: true, issues: [{ severity: "warning", path: "Bundle.meta.profile" }] });
  });
});
