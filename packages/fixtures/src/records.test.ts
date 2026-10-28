import { describe, expect, it } from "vitest";
import { HI_TYPES } from "@yellowparrottech/abdm-core";
import { validateDocumentBundle } from "@yellowparrottech/abdm-fhir";
import { syntheticRecords } from "./index.js";

const range = { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" };

describe("synthetic records", () => {
  it("produces one tagged document bundle per HI type, reproducibly", () => {
    const records = syntheticRecords("asha.rao1@sbx", ["Prescription", "DiagnosticReport"], range);
    expect(records.map((r) => r.hiType)).toEqual(["Prescription", "DiagnosticReport"]);
    expect(records).toEqual(syntheticRecords("asha.rao1@sbx", ["Prescription", "DiagnosticReport"], range));
    for (const { bundle } of records) {
      expect(bundle).toMatchObject({ resourceType: "Bundle", type: "document", meta: { tag: [{ code: "synthetic" }] } });
    }
  });

  it("points the composition at the NRCeS profile for the HI type", () => {
    const [record] = syntheticRecords("asha.rao1@sbx", ["Prescription"], range);
    const composition = (record!.bundle.entry as { resource: { resourceType: string; meta?: { profile: string[] } } }[])[0]!.resource;
    expect(composition.meta?.profile).toEqual(["https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord"]);
  });

  it("dates records inside the requested range", () => {
    for (const { bundle } of syntheticRecords("kiran.das3@sbx", ["OPConsultation", "Invoice", "WellnessRecord"], range)) {
      const t = Date.parse(bundle.timestamp as string);
      expect(t).toBeGreaterThanOrEqual(Date.parse(range.from));
      expect(t).toBeLessThanOrEqual(Date.parse(range.to));
    }
  });

  it("passes structural validation for every HI type", () => {
    for (const record of syntheticRecords("meera.iyer2@sbx", HI_TYPES, range)) {
      expect(validateDocumentBundle(record.bundle)).toEqual({ valid: true, hiType: record.hiType, issues: [] });
    }
  });
});
