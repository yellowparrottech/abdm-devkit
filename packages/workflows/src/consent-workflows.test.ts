import { describe, expect, it } from "vitest";
import { ManualClock } from "@yellowparrottech/abdm-core";
import type { ConsentRequestInput } from "@yellowparrottech/abdm-consent-engine";
import { DEMO_HIP_ID, DEMO_HIU_ID } from "@yellowparrottech/abdm-fixtures";
import { MockGateway, type ConsentScenario } from "@yellowparrottech/abdm-mock-gateway";
import { ConsentWorkflows, InMemoryAuditLog, InMemoryConsentStore, type Actor } from "./index.js";

const doctor: Actor = { id: "user-doctor", hiuIds: [DEMO_HIU_ID] };
const stranger: Actor = { id: "user-other", hiuIds: [DEMO_HIU_ID] };

const request: ConsentRequestInput = {
  patientAbhaAddress: "asha.rao1@sbx",
  hiuId: DEMO_HIU_ID,
  requesterName: "Dr Demo",
  purpose: "CAREMGT",
  hiTypes: ["Prescription"],
  dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" },
  expiresAt: "2026-06-30T00:00:00.000Z",
};

function setup(scenario: ConsentScenario = "approve") {
  const clock = new ManualClock("2026-01-10T09:00:00.000Z");
  const gateway = new MockGateway({ clock, hipId: DEMO_HIP_ID });
  const audit = new InMemoryAuditLog();
  let n = 0;
  const workflows = new ConsentWorkflows({
    environment: "mock",
    clock,
    audit,
    store: new InMemoryConsentStore(),
    gateway: { submitConsentRequest: (id, r) => void gateway.requestConsent(id, r, scenario) },
    newId: () => `id-${++n}`,
  });
  gateway.onCallback((cb) => workflows.handleConsentCallback(cb));
  return { clock, gateway, audit, workflows };
}

async function submit(workflows: ConsentWorkflows, actor = doctor) {
  const pending = workflows.prepareConsentRequest(actor, request);
  if (!pending.ok) throw new Error(pending.error.code);
  const submitted = await workflows.submitApprovedConsentRequest(actor, pending.value.approvalId);
  if (!submitted.ok) throw new Error(submitted.error.code);
  return submitted.value;
}

describe("consent workflows", () => {
  it("shows the person exactly what they are approving", () => {
    const { workflows } = setup();
    const pending = workflows.prepareConsentRequest(doctor, request);
    expect(pending).toMatchObject({
      ok: true,
      value: {
        environment: "mock",
        summary: [
          "Request consent from asha.rao1@sbx for Care Management",
          "Records: Prescription",
          "Period: 2025-01-01 to 2025-12-31",
          "Access ends: 2026-06-30",
          "Requested by: Dr Demo for HIU-DEMO-01",
        ],
      },
    });
  });

  it("runs a request from approval to grant, then authorises a fetch inside it", async () => {
    const { workflows, gateway } = setup();
    const { requestId, state } = await submit(workflows);
    expect(state).toBe("requested");

    await gateway.runUntilIdle();
    const status = workflows.getConsentStatus(doctor, requestId);
    expect(status).toMatchObject({ ok: true, value: { state: "granted", artefacts: [{ hipId: DEMO_HIP_ID }] } });

    const artefactId = status.ok ? status.value.artefacts[0]!.id : "";
    expect(workflows.authoriseHealthInfoRequest(doctor, requestId, { artefactId, hiTypes: ["Prescription"], dateRange: request.dateRange }).ok).toBe(true);
  });

  it("uses each approval only once", async () => {
    const { workflows } = setup();
    const pending = workflows.prepareConsentRequest(doctor, request);
    const approvalId = pending.ok ? pending.value.approvalId : "";
    expect((await workflows.submitApprovedConsentRequest(doctor, approvalId)).ok).toBe(true);
    expect(await workflows.submitApprovedConsentRequest(doctor, approvalId)).toMatchObject({ ok: false, error: { code: "approval_already_used" } });
  });

  it("refuses an approval for different parameters than the caller is sending", async () => {
    const { workflows } = setup();
    const pending = workflows.prepareConsentRequest(doctor, request);
    const approvalId = pending.ok ? pending.value.approvalId : "";
    const wider = { ...request, hiTypes: ["Prescription" as const, "DischargeSummary" as const] };
    expect(await workflows.submitApprovedConsentRequest(doctor, approvalId, wider)).toMatchObject({ ok: false, error: { code: "approval_not_found" } });
    const reordered = Object.fromEntries(Object.entries(request).reverse()) as unknown as ConsentRequestInput;
    expect((await workflows.submitApprovedConsentRequest(doctor, approvalId, reordered)).ok).toBe(true);
  });

  it("does not let another actor use an approval", async () => {
    const { workflows } = setup();
    const pending = workflows.prepareConsentRequest(doctor, request);
    const approvalId = pending.ok ? pending.value.approvalId : "";
    expect(await workflows.submitApprovedConsentRequest(stranger, approvalId)).toMatchObject({ ok: false, error: { code: "approval_not_found" } });
  });

  it("expires approvals that are not acted on", async () => {
    const { workflows, clock } = setup();
    const pending = workflows.prepareConsentRequest(doctor, request);
    clock.advance(10 * 60_000);
    const approvalId = pending.ok ? pending.value.approvalId : "";
    expect(await workflows.submitApprovedConsentRequest(doctor, approvalId)).toMatchObject({ ok: false, error: { code: "approval_expired" } });
  });

  it("refuses an actor who is not permitted for the HIU", () => {
    const { workflows, audit } = setup();
    expect(workflows.prepareConsentRequest({ id: "user-x", hiuIds: ["HIU-ELSEWHERE"] }, request)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(audit.entries.at(-1)).toMatchObject({ action: "consent_approval_issued", outcome: "denied" });
  });

  it("hides one actor's requests from another", async () => {
    const { workflows, gateway } = setup();
    const { requestId } = await submit(workflows);
    await gateway.runUntilIdle();
    expect(workflows.getConsentStatus(stranger, requestId)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      workflows.authoriseHealthInfoRequest(stranger, requestId, { artefactId: "x", hiTypes: ["Prescription"], dateRange: request.dateRange }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("denies a fetch after the patient denies consent", async () => {
    const { workflows, gateway } = setup("deny");
    const { requestId } = await submit(workflows);
    await gateway.runUntilIdle();
    expect(
      workflows.authoriseHealthInfoRequest(doctor, requestId, { artefactId: "x", hiTypes: ["Prescription"], dateRange: request.dateRange }),
    ).toMatchObject({ ok: false, error: { code: "consent_not_granted" } });
  });

  it.each([
    ["no HI types", { hiTypes: [] }],
    ["an unknown HI type", { hiTypes: ["XRay"] }],
    ["an unknown purpose", { purpose: "MARKETING" }],
    ["a reversed date range", { dateRange: { from: "2025-12-31T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" } }],
    ["an expiry in the past", { expiresAt: "2025-01-01T00:00:00.000Z" }],
  ])("rejects a request with %s", (_, override) => {
    const { workflows } = setup();
    expect(workflows.prepareConsentRequest(doctor, { ...request, ...override } as ConsentRequestInput)).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("rejects callbacks for unknown requests without failing", () => {
    const { workflows, audit } = setup();
    workflows.handleConsentCallback({ requestId: "nope", event: { type: "denied", eventId: "e1", at: "2026-01-10T09:00:00.000Z" } });
    expect(audit.entries.at(-1)).toMatchObject({ action: "consent_callback", outcome: "rejected", reason: "unknown request" });
  });

  it("keeps patient details out of the audit log", async () => {
    const { workflows, gateway, audit } = setup();
    await submit(workflows);
    await gateway.runUntilIdle();
    expect(JSON.stringify(audit.entries)).not.toContain(request.patientAbhaAddress);
  });
});
