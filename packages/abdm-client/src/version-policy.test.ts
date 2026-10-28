import { describe, expect, it } from "vitest";
import { DEFAULT_VERSION_POLICY, resolveVersionPolicy } from "./index.js";

describe("version policy", () => {
  it("defaults every flow to V3", () => {
    expect(resolveVersionPolicy()).toEqual({ ok: true, value: DEFAULT_VERSION_POLICY });
  });

  it("lets an operator move an M2 or M3 flow to V2", () => {
    const result = resolveVersionPolicy({ hiuConsent: "v2", hipDataTransfer: "v2" });
    expect(result).toMatchObject({ ok: true, value: { hiuConsent: "v2", hipDataTransfer: "v2", abha: "v3" } });
  });

  it("keeps ABHA on V3", () => {
    expect(resolveVersionPolicy({ abha: "v2" })).toMatchObject({ ok: false, error: { code: "unsupported_version", flow: "abha" } });
  });

  it("rejects unknown flows and versions", () => {
    expect(resolveVersionPolicy({ hiuConset: "v2" })).toMatchObject({ ok: false, error: { code: "unknown_flow" } });
    expect(resolveVersionPolicy({ hiuConsent: "v0.5" })).toMatchObject({ ok: false, error: { code: "unsupported_version" } });
  });
});
