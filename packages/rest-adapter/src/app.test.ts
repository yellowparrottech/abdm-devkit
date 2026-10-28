import { describe, expect, it } from "vitest";
import { ManualClock } from "@yellowparrottech/abdm-core";
import { DEMO_HIP_ID, DEMO_HIU_ID } from "@yellowparrottech/abdm-fixtures";
import { MockGateway } from "@yellowparrottech/abdm-mock-gateway";
import { ConsentWorkflows, HealthInfoWorkflows, InMemoryAuditLog, InMemoryConsentStore, type Actor } from "@yellowparrottech/abdm-workflows";
import { consentListSchema, consentStatusSchema, createOpenApiDocument, createRestApp, errorSchema, healthInfoResultSchema, pendingApprovalSchema, transferListSchema, validationReportSchema } from "./index.js";

const TOKENS: Record<string, Actor> = {
  "token-doctor": { id: "user-doctor", hiuIds: [DEMO_HIU_ID] },
  "token-other": { id: "user-other", hiuIds: [DEMO_HIU_ID] },
};

function setup() {
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
    exposeContent: true,
    gateway: { requestHealthInfo: (id, r) => gateway.requestHealthInfo(id, r) },
  });
  gateway.onCallback((cb) => consents.handleConsentCallback(cb));
  gateway.onDataPush((push) => healthInfo.handleDataPush(push));
  const app = createRestApp({
    consents,
    healthInfo,
    authenticate: (req) => TOKENS[req.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""],
  });
  const call = async (method: string, path: string, body?: unknown, token = "token-doctor") => {
    const res = await app.request(`/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { gateway, call };
}

const consentRequest = {
  patientAbhaAddress: "asha.rao1@sbx",
  hiuId: DEMO_HIU_ID,
  requesterName: "Dr Demo",
  purpose: "CAREMGT",
  hiTypes: ["Prescription"],
  dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" },
  expiresAt: "2026-06-30T00:00:00.000Z",
};

describe("REST API", () => {
  it("rejects requests without a known token", async () => {
    const { call } = setup();
    expect((await call("GET", "/consent-requests", undefined, "nope")).status).toBe(401);
  });

  it("runs consent, fetch and result over HTTP", async () => {
    const { call, gateway } = setup();
    const prepared = await call("POST", "/consent-requests/prepare", consentRequest);
    expect(prepared.status).toBe(200);
    expect(prepared.body.summary[1]).toBe("Records: Prescription");

    const sent = await call("POST", "/consent-requests", { approvalId: prepared.body.approvalId, request: consentRequest });
    expect(sent.status).toBe(201);
    await gateway.runUntilIdle();

    const status = await call("GET", `/consent-requests/${sent.body.requestId}`);
    expect(status.body.state).toBe("granted");

    const fetch = { requestId: sent.body.requestId, artefactId: status.body.artefacts[0].id, hiTypes: ["Prescription"], dateRange: consentRequest.dateRange };
    const preparedFetch = await call("POST", "/health-info-requests/prepare", fetch);
    const requested = await call("POST", "/health-info-requests", { approvalId: preparedFetch.body.approvalId, request: fetch });
    expect(requested.status).toBe(201);
    await gateway.runUntilIdle();

    const result = await call("GET", `/health-info-requests/${requested.body.transactionId}`);
    expect(result.body).toMatchObject({ state: "received", records: [{ hiType: "Prescription", bundle: { resourceType: "Bundle" } }] });
    expect((await call("GET", "/health-info-requests")).body.transfers).toHaveLength(1);
  });

  it("refuses to send a request that differs from the approved one", async () => {
    const { call } = setup();
    const prepared = await call("POST", "/consent-requests/prepare", consentRequest);
    const changed = { ...consentRequest, hiTypes: ["Prescription", "DischargeSummary"] };
    const sent = await call("POST", "/consent-requests", { approvalId: prepared.body.approvalId, request: changed });
    expect(sent).toEqual({ status: 409, body: { error: { code: "approval_not_found" } } });
  });

  it("maps workflow errors to HTTP statuses", async () => {
    const { call } = setup();
    expect((await call("GET", "/consent-requests/unknown")).status).toBe(404);
    expect((await call("POST", "/consent-requests/prepare", { ...consentRequest, hiuId: "HIU-ELSEWHERE" })).status).toBe(403);
    const invalid = await call("POST", "/consent-requests/prepare", { ...consentRequest, hiTypes: ["XRay"] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.detail).toContain("hiTypes");
  });

  it("keeps one user's requests from another", async () => {
    const { call } = setup();
    const prepared = await call("POST", "/consent-requests/prepare", consentRequest);
    const sent = await call("POST", "/consent-requests", { approvalId: prepared.body.approvalId, request: consentRequest });
    expect((await call("GET", `/consent-requests/${sent.body.requestId}`, undefined, "token-other")).status).toBe(404);
    expect((await call("GET", "/consent-requests", undefined, "token-other")).body.consentRequests).toEqual([]);
  });

  it("returns responses that match the published schemas", async () => {
    const { call, gateway } = setup();
    const prepared = await call("POST", "/consent-requests/prepare", consentRequest);
    pendingApprovalSchema.parse(prepared.body);
    const sent = await call("POST", "/consent-requests", { approvalId: prepared.body.approvalId, request: consentRequest });
    consentStatusSchema.parse(sent.body);
    await gateway.runUntilIdle();
    const status = await call("GET", `/consent-requests/${sent.body.requestId}`);
    consentStatusSchema.parse(status.body);
    consentListSchema.parse((await call("GET", "/consent-requests")).body);
    const fetch = { requestId: sent.body.requestId, artefactId: status.body.artefacts[0].id, hiTypes: ["Prescription"], dateRange: consentRequest.dateRange };
    const preparedFetch = await call("POST", "/health-info-requests/prepare", fetch);
    pendingApprovalSchema.parse(preparedFetch.body);
    const requested = await call("POST", "/health-info-requests", { approvalId: preparedFetch.body.approvalId, request: fetch });
    healthInfoResultSchema.parse(requested.body);
    await gateway.runUntilIdle();
    healthInfoResultSchema.parse((await call("GET", `/health-info-requests/${requested.body.transactionId}`)).body);
    transferListSchema.parse((await call("GET", "/health-info-requests")).body);
    validationReportSchema.parse((await call("POST", "/fhir/validate", { resourceType: "Bundle" })).body);
    errorSchema.parse((await call("GET", "/consent-requests/unknown")).body);
  });

  it("publishes an OpenAPI 3.1 document without authentication", async () => {
    const res = await createRestApp({ consents: {} as never, healthInfo: {} as never, authenticate: () => undefined }).request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as ReturnType<typeof createOpenApiDocument>;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toHaveLength(7);
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/(\w+)/g) ?? [];
    for (const r of new Set(refs)) expect(doc.components.schemas).toHaveProperty(r.split("/").at(-1)!);
    expect(JSON.stringify(doc.components.schemas)).not.toContain("$schema");
  });

  it("validates FHIR bundles", async () => {
    const { call } = setup();
    const result = await call("POST", "/fhir/validate", { resourceType: "Bundle", type: "collection", entry: [] });
    expect(result.body.valid).toBe(false);
  });
});
