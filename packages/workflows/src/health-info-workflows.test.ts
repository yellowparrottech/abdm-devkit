import { describe, expect, it } from "vitest";
import { ManualClock, type DataPush } from "@yellowparrottech/abdm-core";
import type { ConsentRequestInput } from "@yellowparrottech/abdm-consent-engine";
import { DEMO_HIP_ID, DEMO_HIU_ID } from "@yellowparrottech/abdm-fixtures";
import { MockGateway } from "@yellowparrottech/abdm-mock-gateway";
import { ConsentWorkflows, HealthInfoWorkflows, InMemoryAuditLog, InMemoryConsentStore, type Actor, type HealthInfoRequestInput } from "./index.js";

const doctor: Actor = { id: "user-doctor", hiuIds: [DEMO_HIU_ID] };

const consentRequest: ConsentRequestInput = {
  patientAbhaAddress: "asha.rao1@sbx",
  hiuId: DEMO_HIU_ID,
  requesterName: "Dr Demo",
  purpose: "CAREMGT",
  hiTypes: ["Prescription", "DiagnosticReport"],
  dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" },
  expiresAt: "2026-06-30T00:00:00.000Z",
};

async function grantedConsent({ exposeContent = true } = {}) {
  const clock = new ManualClock("2026-01-10T09:00:00.000Z");
  const gateway = new MockGateway({ clock, hipId: DEMO_HIP_ID });
  const audit = new InMemoryAuditLog();
  const consents = new ConsentWorkflows({
    environment: "mock",
    clock,
    audit,
    store: new InMemoryConsentStore(),
    gateway: { submitConsentRequest: (id, r) => void gateway.requestConsent(id, r, "approve") },
  });
  const healthInfo = new HealthInfoWorkflows({
    environment: "mock",
    clock,
    audit,
    consents,
    exposeContent,
    gateway: { requestHealthInfo: (id, r) => gateway.requestHealthInfo(id, r) },
  });
  const pushes: DataPush[] = [];
  gateway.onCallback((cb) => consents.handleConsentCallback(cb));
  gateway.onDataPush(async (push) => {
    pushes.push(push);
    await healthInfo.handleDataPush(push);
  });

  const pending = consents.prepareConsentRequest(doctor, consentRequest);
  const sent = await consents.submitApprovedConsentRequest(doctor, pending.ok ? pending.value.approvalId : "");
  const requestId = sent.ok ? sent.value.requestId : "";
  await gateway.runUntilIdle();
  const status = consents.getConsentStatus(doctor, requestId);
  const artefactId = status.ok ? status.value.artefacts[0]!.id : "";
  const fetch: HealthInfoRequestInput = { requestId, artefactId, hiTypes: ["Prescription"], dateRange: consentRequest.dateRange };
  return { clock, gateway, audit, consents, healthInfo, pushes, fetch };
}

async function fetchRecords(ctx: Awaited<ReturnType<typeof grantedConsent>>, input = ctx.fetch) {
  const pending = ctx.healthInfo.prepareHealthInfoRequest(doctor, input);
  if (!pending.ok) throw new Error(pending.error.code);
  const sent = await ctx.healthInfo.submitApprovedHealthInfoRequest(doctor, pending.value.approvalId, input);
  if (!sent.ok) throw new Error(sent.error.code);
  await ctx.gateway.runUntilIdle();
  return sent.value.transactionId;
}

describe("health-information workflows", () => {
  it("fetches, decrypts and returns synthetic records under a granted consent", async () => {
    const ctx = await grantedConsent();
    const transactionId = await fetchRecords(ctx);
    const result = ctx.healthInfo.getHealthInfoResult(doctor, transactionId);
    expect(result).toMatchObject({ ok: true, value: { state: "received", contentExposed: true, records: [{ hiType: "Prescription" }] } });
    const bundle = result.ok ? (result.value.records[0]!.bundle as { resourceType: string; meta: { tag: { code: string }[] } }) : undefined;
    expect(bundle?.resourceType).toBe("Bundle");
    expect(bundle?.meta.tag[0]?.code).toBe("synthetic");
  });

  it("sends only ciphertext through the gateway", async () => {
    const ctx = await grantedConsent();
    await fetchRecords(ctx);
    const pushed = JSON.stringify(ctx.pushes);
    expect(pushed).not.toContain("Bundle");
    expect(pushed).not.toContain("asha.rao1");
  });

  it("returns metadata only when content is not exposed", async () => {
    const ctx = await grantedConsent({ exposeContent: false });
    const transactionId = await fetchRecords(ctx);
    const result = ctx.healthInfo.getHealthInfoResult(doctor, transactionId);
    expect(result).toMatchObject({ ok: true, value: { contentExposed: false, records: [{ hiType: "Prescription" }] } });
    expect(result.ok && "bundle" in result.value.records[0]!).toBe(false);
  });

  it("refuses to expose content outside mock unless the deployment is declared controlled", async () => {
    const { consents, clock, audit } = await grantedConsent();
    const base = { clock, audit, consents, gateway: { requestHealthInfo: () => {} }, exposeContent: true };
    expect(() => new HealthInfoWorkflows({ ...base, environment: "sandbox" })).toThrow(/controlled deployment/);
    expect(() => new HealthInfoWorkflows({ ...base, environment: "certified", controlledDeployment: true })).not.toThrow();
  });

  it("refuses record types the consent does not cover before asking for approval", async () => {
    const ctx = await grantedConsent();
    expect(ctx.healthInfo.prepareHealthInfoRequest(doctor, { ...ctx.fetch, hiTypes: ["DischargeSummary"] })).toMatchObject({
      ok: false,
      error: { code: "hi_type_not_consented" },
    });
  });

  it("uses each approval once and only for its exact request", async () => {
    const ctx = await grantedConsent();
    const pending = ctx.healthInfo.prepareHealthInfoRequest(doctor, ctx.fetch);
    const approvalId = pending.ok ? pending.value.approvalId : "";
    const wider = { ...ctx.fetch, hiTypes: ["Prescription" as const, "DiagnosticReport" as const] };
    expect(await ctx.healthInfo.submitApprovedHealthInfoRequest(doctor, approvalId, wider)).toMatchObject({ ok: false, error: { code: "approval_not_found" } });
    expect((await ctx.healthInfo.submitApprovedHealthInfoRequest(doctor, approvalId, ctx.fetch)).ok).toBe(true);
    expect(await ctx.healthInfo.submitApprovedHealthInfoRequest(doctor, approvalId, ctx.fetch)).toMatchObject({ ok: false, error: { code: "approval_already_used" } });
  });

  it("discards stored records once the consent is revoked", async () => {
    const ctx = await grantedConsent();
    const transactionId = await fetchRecords(ctx);
    ctx.consents.handleConsentCallback({ requestId: ctx.fetch.requestId, event: { type: "revoked", eventId: "revoke-1", at: ctx.clock.now().toISOString() } });
    expect(ctx.healthInfo.getHealthInfoResult(doctor, transactionId)).toMatchObject({ ok: false, error: { code: "consent_not_granted" } });
  });

  it("hides one actor's transfers from another", async () => {
    const ctx = await grantedConsent();
    const transactionId = await fetchRecords(ctx);
    expect(ctx.healthInfo.listTransfers(doctor)).toEqual([{ transactionId, requestId: ctx.fetch.requestId, state: "received", recordCount: 1 }]);
    expect(ctx.healthInfo.listTransfers({ id: "user-other", hiuIds: [DEMO_HIU_ID] })).toEqual([]);
    expect(ctx.consents.listConsentRequests({ id: "user-other", hiuIds: [DEMO_HIU_ID] })).toEqual([]);
    expect(ctx.consents.listConsentRequests(doctor).map((s) => s.state)).toEqual(["granted"]);
    expect(ctx.healthInfo.getHealthInfoResult({ id: "user-other", hiuIds: [DEMO_HIU_ID] }, transactionId)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("rejects pushes for unknown or completed transfers", async () => {
    const ctx = await grantedConsent();
    await fetchRecords(ctx);
    const [push] = ctx.pushes;
    await ctx.healthInfo.handleDataPush({ ...push!, transactionId: "unknown" });
    await ctx.healthInfo.handleDataPush(push!);
    const rejected = ctx.audit.entries.filter((e) => e.action === "health_info_received" && e.outcome === "rejected");
    expect(rejected.map((e) => e.reason)).toEqual(["unknown transfer", "transfer already received"]);
  });

  it("fails a transfer whose records cannot be decrypted", async () => {
    const ctx = await grantedConsent();
    const pending = ctx.healthInfo.prepareHealthInfoRequest(doctor, ctx.fetch);
    const sent = await ctx.healthInfo.submitApprovedHealthInfoRequest(doctor, pending.ok ? pending.value.approvalId : "");
    const transactionId = sent.ok ? sent.value.transactionId : "";
    await ctx.healthInfo.handleDataPush({
      transactionId,
      keyMaterial: { publicKey: "AAAA", nonce: "AAAA" },
      entries: [{ hiType: "Prescription", careContextReference: "CC-1", media: "application/fhir+json", content: "bm90IGVuY3J5cHRlZA==" }],
    });
    expect(ctx.healthInfo.getHealthInfoResult(doctor, transactionId)).toMatchObject({
      ok: true,
      value: { state: "failed", records: [], failure: "records could not be decrypted or parsed" },
    });
  });

  it("fails a transfer that pushes record types that were not requested", async () => {
    const ctx = await grantedConsent();
    const pending = ctx.healthInfo.prepareHealthInfoRequest(doctor, ctx.fetch);
    const sent = await ctx.healthInfo.submitApprovedHealthInfoRequest(doctor, pending.ok ? pending.value.approvalId : "");
    const transactionId = sent.ok ? sent.value.transactionId : "";
    await ctx.healthInfo.handleDataPush({
      transactionId,
      keyMaterial: { publicKey: "AAAA", nonce: "AAAA" },
      entries: [{ hiType: "DischargeSummary", careContextReference: "CC-1", media: "application/fhir+json", content: "AAAA" }],
    });
    expect(ctx.healthInfo.getHealthInfoResult(doctor, transactionId)).toMatchObject({ ok: true, value: { state: "failed" } });
  });

  it("keeps patient details and record content out of the audit log", async () => {
    const ctx = await grantedConsent();
    const transactionId = await fetchRecords(ctx);
    ctx.healthInfo.getHealthInfoResult(doctor, transactionId);
    const log = JSON.stringify(ctx.audit.entries);
    expect(log).not.toContain("asha.rao1");
    expect(log).not.toContain("MedicationRequest");
  });
});
