// Regression tests for defects found in the security review of 2026-10-27.
import { describe, expect, it } from "vitest";
import { ManualClock, type DataPush, type HealthInfoGatewayRequest } from "@yellowparrottech/abdm-core";
import type { ConsentRequestInput } from "@yellowparrottech/abdm-consent-engine";
import { encrypt, generateKeyMaterial } from "@yellowparrottech/abdm-crypto";
import { DEMO_HIP_ID, DEMO_HIU_ID } from "@yellowparrottech/abdm-fixtures";
import { MockGateway } from "@yellowparrottech/abdm-mock-gateway";
import { ConsentWorkflows, HealthInfoWorkflows, InMemoryAuditLog, InMemoryConsentStore, type Actor, type HealthInfoRequestInput } from "./index.js";

const doctor: Actor = { id: "user-doctor", hiuIds: [DEMO_HIU_ID] };
const request: ConsentRequestInput = {
  patientAbhaAddress: "asha.rao1@sbx",
  hiuId: DEMO_HIU_ID,
  requesterName: "Dr Demo",
  purpose: "CAREMGT",
  hiTypes: ["Prescription"],
  dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" },
  expiresAt: "2026-06-30T00:00:00.000Z",
};

/** Consent granted through the mock gateway; record pushes are built by hand so tests control them. */
async function setup() {
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
  gateway.onCallback((cb) => consents.handleConsentCallback(cb));
  const requests: { transactionId: string; request: HealthInfoGatewayRequest }[] = [];
  const healthInfo = new HealthInfoWorkflows({
    environment: "mock",
    clock,
    audit,
    consents,
    exposeContent: true,
    gateway: { requestHealthInfo: (transactionId, r) => void requests.push({ transactionId, request: r }) },
  });

  const pending = consents.prepareConsentRequest(doctor, request);
  const sent = await consents.submitApprovedConsentRequest(doctor, pending.ok ? pending.value.approvalId : "");
  const requestId = sent.ok ? sent.value.requestId : "";
  await gateway.runUntilIdle();
  const status = consents.getConsentStatus(doctor, requestId);
  const fetch: HealthInfoRequestInput = { requestId, artefactId: status.ok ? status.value.artefacts[0]!.id : "", hiTypes: ["Prescription"], dateRange: request.dateRange };

  const startFetch = async () => {
    const p = healthInfo.prepareHealthInfoRequest(doctor, fetch);
    const s = await healthInfo.submitApprovedHealthInfoRequest(doctor, p.ok ? p.value.approvalId : "");
    if (!s.ok) throw new Error(s.error.code);
    return requests.at(-1)!;
  };
  const pushFor = async ({ transactionId, request: r }: { transactionId: string; request: HealthInfoGatewayRequest }, body: object): Promise<DataPush> => {
    const sender = generateKeyMaterial();
    const content = await encrypt({ plaintext: JSON.stringify(body), senderPrivateKey: sender.privateKey, senderNonce: sender.nonce, receiverPublicKey: r.keyMaterial.publicKey, receiverNonce: r.keyMaterial.nonce });
    return { transactionId, keyMaterial: { publicKey: sender.x509PublicKey, nonce: sender.nonce }, entries: [{ hiType: "Prescription", careContextReference: "CC-1", media: "application/fhir+json", content }] };
  };
  return { clock, audit, consents, healthInfo, fetch, requestId, startFetch, pushFor };
}

describe("security review regressions", () => {
  it("processes only the first of two concurrent pushes", async () => {
    const ctx = await setup();
    const sent = await ctx.startFetch();
    const [real, forged] = await Promise.all([ctx.pushFor(sent, { who: "HIP" }), ctx.pushFor(sent, { who: "ATTACKER" })]);
    await Promise.all([ctx.healthInfo.handleDataPush(real), ctx.healthInfo.handleDataPush(forged)]);
    const result = ctx.healthInfo.getHealthInfoResult(doctor, sent.transactionId);
    expect(result).toMatchObject({ ok: true, value: { state: "received", records: [{ bundle: { who: "HIP" } }] } });
    expect(ctx.audit.entries.some((e) => e.reason === "a push is already being processed")).toBe(true);
  });

  it("rejects a push that arrives after the key material expired", async () => {
    const ctx = await setup();
    const sent = await ctx.startFetch();
    ctx.clock.advance(2 * 60 * 60_000);
    await ctx.healthInfo.handleDataPush(await ctx.pushFor(sent, { who: "HIP" }));
    expect(ctx.healthInfo.listTransfers(doctor)[0]).toMatchObject({ state: "failed", recordCount: 0, failure: "key material expired before the records arrived" });
  });

  it("deletes stored records as soon as consent is revoked, without waiting for a read", async () => {
    const ctx = await setup();
    const sent = await ctx.startFetch();
    await ctx.healthInfo.handleDataPush(await ctx.pushFor(sent, { who: "HIP" }));
    ctx.consents.handleConsentCallback({ requestId: ctx.requestId, event: { type: "revoked", eventId: "revoke-1", at: ctx.clock.now().toISOString() } });
    expect(ctx.healthInfo.listTransfers(doctor)[0]).toMatchObject({ state: "discarded", recordCount: 0 });
  });

  it("does not store a push that arrives after consent was revoked", async () => {
    const ctx = await setup();
    const sent = await ctx.startFetch();
    ctx.consents.handleConsentCallback({ requestId: ctx.requestId, event: { type: "revoked", eventId: "revoke-1", at: ctx.clock.now().toISOString() } });
    await ctx.healthInfo.handleDataPush(await ctx.pushFor(sent, { who: "HIP" }));
    expect(ctx.healthInfo.listTransfers(doctor)[0]).toMatchObject({ state: "discarded", recordCount: 0 });
  });

  it("deletes records once consent expires with the passage of time", async () => {
    const ctx = await setup();
    const sent = await ctx.startFetch();
    await ctx.healthInfo.handleDataPush(await ctx.pushFor(sent, { who: "HIP" }));
    ctx.clock.advance(Date.parse(request.expiresAt) - ctx.clock.now().getTime());
    ctx.healthInfo.discardLapsed();
    expect(ctx.healthInfo.listTransfers(doctor)[0]).toMatchObject({ state: "discarded", recordCount: 0 });
  });

  it("re-checks facility permission when an approved consent request is submitted", async () => {
    const ctx = await setup();
    const pending = ctx.consents.prepareConsentRequest(doctor, request);
    const approvalId = pending.ok ? pending.value.approvalId : "";
    expect(await ctx.consents.submitApprovedConsentRequest({ id: doctor.id, hiuIds: [] }, approvalId)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("refuses fetches by a user whose facility access was removed", async () => {
    const ctx = await setup();
    const removed = { id: doctor.id, hiuIds: [] };
    expect(ctx.healthInfo.prepareHealthInfoRequest(removed, ctx.fetch)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("refuses a consent request that expired while waiting for approval", async () => {
    const ctx = await setup();
    const soon = { ...request, expiresAt: new Date(ctx.clock.now().getTime() + 60_000).toISOString() };
    const pending = ctx.consents.prepareConsentRequest(doctor, soon);
    ctx.clock.advance(2 * 60_000);
    expect(await ctx.consents.submitApprovedConsentRequest(doctor, pending.ok ? pending.value.approvalId : "")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("sends what was approved even if the caller changes its object afterwards", async () => {
    const ctx = await setup();
    const mutable = structuredClone(request);
    const pending = ctx.consents.prepareConsentRequest(doctor, mutable);
    mutable.hiTypes.push("DischargeSummary");
    const sent = await ctx.consents.submitApprovedConsentRequest(doctor, pending.ok ? pending.value.approvalId : "");
    expect(sent.ok).toBe(true);
    const submitted = ctx.audit.entries.filter((e) => e.action === "consent_request_submitted").at(-1);
    expect(submitted?.hiTypes).toEqual(["Prescription"]);
  });

  it("refuses a fetch with no HI types", async () => {
    const ctx = await setup();
    expect(ctx.healthInfo.prepareHealthInfoRequest(doctor, { ...ctx.fetch, hiTypes: [] })).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("does not copy arbitrary caller text into the audit log", async () => {
    const ctx = await setup();
    ctx.consents.getConsentStatus(doctor, "x\n<script>forged entry</script>");
    expect(ctx.audit.entries.at(-1)?.requestId).toBe("<invalid id>");
  });
});
