import { describe, expect, it } from "vitest";
import {
  applyConsentEvent,
  checkHealthInfoRequest,
  consentStateAt,
  createConsentTransaction,
  type ConsentArtefact,
  type ConsentEvent,
  type ConsentRequestInput,
  type ConsentTransaction,
} from "./index.js";

const request: ConsentRequestInput = {
  patientAbhaAddress: "asha.rao@sbx",
  hiuId: "HIU-DEMO",
  requesterName: "Dr Demo",
  purpose: "CAREMGT",
  hiTypes: ["Prescription", "DiagnosticReport"],
  dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z" },
  expiresAt: "2026-06-30T00:00:00.000Z",
};

const artefact: ConsentArtefact = {
  id: "artefact-1",
  hipId: "HIP-DEMO",
  hiuId: "HIU-DEMO",
  purpose: "CAREMGT",
  hiTypes: ["Prescription"],
  dateRange: { from: "2025-03-01T00:00:00.000Z", to: "2025-09-30T00:00:00.000Z" },
  expiresAt: "2026-03-31T00:00:00.000Z",
};

let seq = 0;
const event = <T extends ConsentEvent["type"]>(type: T, extra: Omit<Extract<ConsentEvent, { type: T }>, "type" | "eventId" | "at"> = {} as never) =>
  ({ type, eventId: `e${++seq}`, at: "2026-01-02T00:00:00.000Z", ...extra }) as ConsentEvent;

function apply(tx: ConsentTransaction, ...events: ConsentEvent[]): ConsentTransaction {
  return events.reduce((current, e) => {
    const result = applyConsentEvent(current, e);
    if (!result.ok) throw new Error(`unexpected ${result.error.code}`);
    return result.value;
  }, tx);
}

const fresh = () => createConsentTransaction("req-1", request, "2026-01-01T00:00:00.000Z");
const granted = () => apply(fresh(), event("acknowledged", { consentRequestId: "cr-1" }), event("granted", { artefacts: [artefact] }));

describe("consent state machine", () => {
  it("moves from requested to granted through the patient's approval", () => {
    const tx = granted();
    expect(tx.state).toBe("granted");
    expect(tx.consentRequestId).toBe("cr-1");
    expect(tx.artefacts).toEqual([artefact]);
  });

  it("ignores a replayed callback with the same event ID", () => {
    const deny = event("denied");
    const once = apply(fresh(), deny);
    expect(apply(once, deny)).toBe(once);
  });

  it("accepts a decision that arrives before the acknowledgement", () => {
    const tx = apply(fresh(), event("granted", { artefacts: [artefact] }), event("acknowledged", { consentRequestId: "cr-late" }));
    expect(tx.state).toBe("granted");
    expect(tx.consentRequestId).toBe("cr-late");
  });

  it("rejects a grant after the patient denied", () => {
    const result = applyConsentEvent(apply(fresh(), event("denied")), event("granted", { artefacts: [artefact] }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_transition", from: "denied", event: "granted" } });
  });

  it.each([
    ["an HI type that was not requested", { hiTypes: ["Prescription", "DischargeSummary"] }],
    ["a wider date range", { dateRange: { from: "2024-01-01T00:00:00.000Z", to: "2025-06-01T00:00:00.000Z" } }],
    ["a later expiry", { expiresAt: "2027-01-01T00:00:00.000Z" }],
    ["a different HIU", { hiuId: "HIU-OTHER" }],
  ])("rejects an artefact granting %s", (_, override) => {
    const result = applyConsentEvent(fresh(), event("granted", { artefacts: [{ ...artefact, ...override } as ConsentArtefact] }));
    expect(result).toMatchObject({ ok: false, error: { code: "artefact_exceeds_request" } });
  });

  it.each([
    ["an unreadable expiry", { expiresAt: "not-a-date" }],
    ["an unreadable date range", { dateRange: { from: "soon", to: "2025-09-30T00:00:00.000Z" } }],
    ["a date range that ends before it starts", { dateRange: { from: "2025-09-30T00:00:00.000Z", to: "2025-03-01T00:00:00.000Z" } }],
  ])("rejects an artefact with %s", (_, override) => {
    const result = applyConsentEvent(fresh(), event("granted", { artefacts: [{ ...artefact, ...override } as ConsentArtefact] }));
    expect(result).toMatchObject({ ok: false, error: { code: "artefact_exceeds_request" } });
  });

  it("never treats an unreadable expiry as open-ended", () => {
    const tx = { ...granted(), artefacts: [{ ...artefact, expiresAt: "not-a-date" }] };
    expect(consentStateAt(tx, new Date("2026-02-01T00:00:00.000Z"))).toBe("expired");
  });

  it("treats a grant as expired once every artefact has expired", () => {
    expect(consentStateAt(granted(), new Date("2026-03-30T00:00:00.000Z"))).toBe("granted");
    expect(consentStateAt(granted(), new Date("2026-03-31T00:00:00.000Z"))).toBe("expired");
  });
});

describe("health-information policy", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");
  const valid = { hiuId: "HIU-DEMO", artefactId: "artefact-1", hiTypes: ["Prescription" as const], dateRange: artefact.dateRange };

  it("allows a request inside the granted scope", () => {
    expect(checkHealthInfoRequest(granted(), valid, now)).toEqual({ ok: true, value: artefact });
  });

  it.each([
    ["consent was never granted", fresh(), valid, now, "consent_not_granted"],
    ["consent has expired", granted(), valid, new Date("2026-04-01T00:00:00.000Z"), "consent_expired"],
    ["the artefact is unknown", granted(), { ...valid, artefactId: "artefact-9" }, now, "unknown_artefact"],
    ["another HIU asks", granted(), { ...valid, hiuId: "HIU-OTHER" }, now, "wrong_requester"],
    ["an HI type was not granted", granted(), { ...valid, hiTypes: ["DiagnosticReport" as const] }, now, "hi_type_not_consented"],
    [
      "the dates fall outside the grant",
      granted(),
      { ...valid, dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-04-01T00:00:00.000Z" } },
      now,
      "date_range_outside_consent",
    ],
  ])("denies when %s", (_, tx, req, at, code) => {
    expect(checkHealthInfoRequest(tx, req, at)).toMatchObject({ ok: false, error: { code } });
  });

  it("denies once the consent is revoked", () => {
    const revoked = apply(granted(), event("revoked"));
    expect(checkHealthInfoRequest(revoked, valid, now)).toMatchObject({ ok: false, error: { code: "consent_not_granted", state: "revoked" } });
  });
});
