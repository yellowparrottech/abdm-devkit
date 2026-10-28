import { describe, expect, it } from "vitest";
import { ManualClock } from "@yellowparrottech/abdm-core";
import {
  applyConsentEvent,
  checkHealthInfoRequest,
  createConsentTransaction,
  type ConsentRequestInput,
  type ConsentTransaction,
} from "@yellowparrottech/abdm-consent-engine";
import { DEMO_HIP_ID, DEMO_HIU_ID, syntheticPatients } from "@yellowparrottech/abdm-fixtures";
import { MockGateway, type ConsentScenario } from "@yellowparrottech/abdm-mock-gateway";

const [patient] = syntheticPatients(2026, 1);

const request: ConsentRequestInput = {
  patientAbhaAddress: patient!.abhaAddress,
  hiuId: DEMO_HIU_ID,
  requesterName: "Dr Demo",
  purpose: "CAREMGT",
  hiTypes: ["Prescription", "DiagnosticReport"],
  dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" },
  expiresAt: "2026-06-30T00:00:00.000Z",
};

async function run(scenario: ConsentScenario) {
  const clock = new ManualClock("2026-01-10T09:00:00.000Z");
  const gateway = new MockGateway({ clock, hipId: DEMO_HIP_ID });
  let tx: ConsentTransaction = createConsentTransaction("req-1", request, clock.now().toISOString());
  const rejected: string[] = [];
  gateway.onCallback(({ event }) => {
    const result = applyConsentEvent(tx, event);
    if (result.ok) tx = result.value;
    else rejected.push(result.error.code);
  });
  gateway.requestConsent(tx.requestId, request, scenario);
  await gateway.runUntilIdle();
  return { tx, rejected, clock };
}

const fetchPrescriptions = (tx: ConsentTransaction, now: Date) =>
  checkHealthInfoRequest(tx, { hiuId: DEMO_HIU_ID, artefactId: tx.artefacts[0]?.id ?? "none", hiTypes: ["Prescription"], dateRange: request.dateRange }, now);

describe("consent flow against the mock gateway", () => {
  it.each([
    ["approve", "granted"],
    ["approve_narrower", "granted"],
    ["deny", "denied"],
    ["expire", "expired"],
    ["lost_notification", "pending_patient"],
    ["duplicate_notification", "granted"],
    ["late_acknowledgement", "granted"],
  ] as const)("%s ends in %s", async (scenario, state) => {
    const { tx, rejected } = await run(scenario);
    expect(tx.state).toBe(state);
    expect(rejected).toEqual([]);
  });

  it("allows a fetch only after approval", async () => {
    const approved = await run("approve");
    expect(fetchPrescriptions(approved.tx, approved.clock.now()).ok).toBe(true);
    const denied = await run("deny");
    expect(fetchPrescriptions(denied.tx, denied.clock.now())).toMatchObject({ ok: false, error: { code: "consent_not_granted" } });
  });

  it("refuses HI types the patient left out of a narrower approval", async () => {
    const { tx, clock } = await run("approve_narrower");
    const result = checkHealthInfoRequest(
      tx,
      { hiuId: DEMO_HIU_ID, artefactId: tx.artefacts[0]!.id, hiTypes: ["DiagnosticReport"], dateRange: request.dateRange },
      clock.now(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "hi_type_not_consented" } });
  });

  it("applies a duplicate notification only once", async () => {
    const { tx } = await run("duplicate_notification");
    expect(tx.appliedEventIds.filter((id) => id.endsWith(":decision"))).toHaveLength(1);
  });

  it("delivers callbacks on simulated time", async () => {
    const clock = new ManualClock("2026-01-10T09:00:00.000Z");
    const gateway = new MockGateway({ clock, hipId: DEMO_HIP_ID, ackDelayMs: 1_000, decisionDelayMs: 60_000 });
    const seen: string[] = [];
    gateway.onCallback(({ event }) => seen.push(`${event.type}@${event.at}`));
    gateway.requestConsent("req-1", request, "approve");
    await gateway.advance(999);
    expect(seen).toEqual([]);
    await gateway.advance(1);
    expect(seen).toEqual(["acknowledged@2026-01-10T09:00:01.000Z"]);
    await gateway.advance(60_000);
    expect(seen).toEqual(["acknowledged@2026-01-10T09:00:01.000Z", "granted@2026-01-10T09:01:01.000Z"]);
  });
});
