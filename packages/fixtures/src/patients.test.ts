import { describe, expect, it } from "vitest";
import { syntheticPatients } from "./index.js";

describe("synthetic patients", () => {
  it("are reproducible from a seed", () => {
    expect(syntheticPatients(42, 5)).toEqual(syntheticPatients(42, 5));
    expect(syntheticPatients(42, 5)).not.toEqual(syntheticPatients(43, 5));
  });

  it("carry clearly synthetic identifiers", () => {
    for (const p of syntheticPatients(7, 50)) {
      expect(p.synthetic).toBe(true);
      expect(p.abhaNumber).toMatch(/^00-\d{4}-\d{4}-\d{4}$/);
      expect(p.abhaAddress).toMatch(/^[a-z.]+\d+@sbx$/);
      expect(p.mobile).toMatch(/^\+91-0\d{9}$/);
    }
  });

  it("gives every patient a distinct ABHA address", () => {
    const addresses = syntheticPatients(1, 200).map((p) => p.abhaAddress);
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});
