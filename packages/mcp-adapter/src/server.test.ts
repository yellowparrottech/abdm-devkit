import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { ManualClock } from "@yellowparrottech/abdm-core";
import { DEMO_HIP_ID, DEMO_HIU_ID } from "@yellowparrottech/abdm-fixtures";
import { CONSENT_SCENARIOS, MockGateway, type ConsentScenario } from "@yellowparrottech/abdm-mock-gateway";
import { ConsentWorkflows, HealthInfoWorkflows, InMemoryAuditLog, InMemoryConsentStore } from "@yellowparrottech/abdm-workflows";
import { createAbdmMcpServer } from "./index.js";

type Answer = { action: "accept"; content: { confirm: boolean } } | { action: "decline" };

async function setup(answer: Answer, { canConfirm = true, exposeContent = true } = {}) {
  const clock = new ManualClock("2026-01-10T09:00:00.000Z");
  const gateway = new MockGateway({ clock, hipId: DEMO_HIP_ID });
  let scenario: ConsentScenario = "approve";
  const workflows = new ConsentWorkflows({
    environment: "mock",
    clock,
    audit: new InMemoryAuditLog(),
    store: new InMemoryConsentStore(),
    gateway: { submitConsentRequest: (id, r) => void gateway.requestConsent(id, r, scenario) },
  });
  gateway.onCallback((cb) => workflows.handleConsentCallback(cb));
  const healthInfo = new HealthInfoWorkflows({
    environment: "mock",
    clock,
    audit: new InMemoryAuditLog(),
    consents: workflows,
    exposeContent,
    gateway: { requestHealthInfo: (id, r) => gateway.requestHealthInfo(id, r) },
  });
  gateway.onDataPush((push) => healthInfo.handleDataPush(push));

  const server = createAbdmMcpServer({
    workflows,
    healthInfo,
    actor: { id: "user-doctor", hiuIds: [DEMO_HIU_ID] },
    environment: "mock",
    hiuId: DEMO_HIU_ID,
    requesterName: "Dr Demo",
    mock: { scenarios: CONSENT_SCENARIOS, selectScenario: (name) => (scenario = name as ConsentScenario) },
  });

  const prompts: string[] = [];
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: canConfirm ? { elicitation: { form: {} } } : {} });
  if (canConfirm) {
    client.setRequestHandler("elicitation/create", async (req) => {
      prompts.push(req.params.message);
      return answer;
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, gateway, prompts, sentToGateway: () => gateway.pendingCount() };
}

const consentArgs = {
  patientAbhaAddress: "asha.rao1@sbx",
  purpose: "CAREMGT",
  hiTypes: ["Prescription"],
  dateFrom: "2025-01-01T00:00:00.000Z",
  dateTo: "2025-12-31T00:00:00.000Z",
  expiresAt: "2026-06-30T00:00:00.000Z",
};

describe("ABDM MCP server", () => {
  it("lists the workflow tools", async () => {
    const { client } = await setup({ action: "decline" });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "abdm_consent_request",
      "abdm_consent_status",
      "abdm_demo_scenarios",
      "abdm_fhir_generate",
      "abdm_fhir_validate",
      "abdm_health_info_request",
      "abdm_health_info_result",
      "abdm_workflow_status",
    ]);
    expect(tools.find((t) => t.name === "abdm_consent_status")?.annotations?.readOnlyHint).toBe(true);
  });

  it("sends a consent request only after the user confirms it, then reports the grant", async () => {
    const { client, gateway, prompts } = await setup({ action: "accept", content: { confirm: true } });
    const sent = await client.callTool({ name: "abdm_consent_request", arguments: consentArgs });
    expect(sent.isError).toBeFalsy();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("[MOCK, synthetic data]");
    expect(prompts[0]).toContain("Records: Prescription");

    expect(sent.structuredContent).toMatchObject({ sent: true, status: { state: "requested" } });
    const { requestId } = (sent.structuredContent as { status: { requestId: string } }).status;
    await gateway.runUntilIdle();
    const status = await client.callTool({ name: "abdm_consent_status", arguments: { requestId } });
    expect(status.structuredContent).toMatchObject({ state: "granted", artefacts: [{ hipId: DEMO_HIP_ID, hiTypes: ["Prescription"] }] });
  });

  it("sends nothing when the user declines", async () => {
    const { client } = await setup({ action: "decline" });
    const result = await client.callTool({ name: "abdm_consent_request", arguments: consentArgs });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ sent: false, reason: "The user did not confirm the consent request." });
  });

  it("sends nothing when the client cannot ask the user to confirm", async () => {
    const { client, sentToGateway } = await setup({ action: "accept", content: { confirm: true } }, { canConfirm: false });
    const outcome = await client.callTool({ name: "abdm_consent_request", arguments: consentArgs }).then(
      (r) => (r.isError ? "error" : "sent"),
      () => "error",
    );
    expect(outcome).toBe("error");
    expect(sentToGateway()).toBe(0);
  });

  it("follows the chosen mock scenario", async () => {
    const { client, gateway } = await setup({ action: "accept", content: { confirm: true } });
    const sent = await client.callTool({ name: "abdm_consent_request", arguments: { ...consentArgs, scenario: "deny" } });
    await gateway.runUntilIdle();
    const { requestId } = (sent.structuredContent as { status: { requestId: string } }).status;
    const status = await client.callTool({ name: "abdm_consent_status", arguments: { requestId } });
    expect(status.structuredContent).toMatchObject({ state: "denied" });
  });

  it("does not carry a mock scenario over to later requests", async () => {
    const { client, gateway } = await setup({ action: "accept", content: { confirm: true } });
    await client.callTool({ name: "abdm_consent_request", arguments: { ...consentArgs, scenario: "deny" } });
    const second = await client.callTool({ name: "abdm_consent_request", arguments: consentArgs });
    await gateway.runUntilIdle();
    const { requestId } = (second.structuredContent as { status: { requestId: string } }).status;
    const status = await client.callTool({ name: "abdm_consent_status", arguments: { requestId } });
    expect(status.structuredContent).toMatchObject({ state: "granted" });
  });

  it("reports workflow errors as tool errors", async () => {
    const { client } = await setup({ action: "accept", content: { confirm: true } });
    const status = await client.callTool({ name: "abdm_consent_status", arguments: { requestId: "unknown" } });
    expect(status.isError).toBe(true);
    expect(JSON.stringify(status.content)).toContain("not_found");
  });

  async function grantedConsent(client: Client, gateway: MockGateway) {
    const sent = await client.callTool({ name: "abdm_consent_request", arguments: consentArgs });
    const { requestId } = (sent.structuredContent as { status: { requestId: string } }).status;
    await gateway.runUntilIdle();
    const status = await client.callTool({ name: "abdm_consent_status", arguments: { requestId } });
    const artefactId = (status.structuredContent as { artefacts: { id: string }[] }).artefacts[0]!.id;
    return { requestId, artefactId };
  }

  const fetchArgs = (ids: { requestId: string; artefactId: string }) => ({ ...ids, hiTypes: ["Prescription"], dateFrom: consentArgs.dateFrom, dateTo: consentArgs.dateTo });

  it("runs consent, encrypted transfer and decryption end to end", async () => {
    const { client, gateway, prompts } = await setup({ action: "accept", content: { confirm: true } });
    const ids = await grantedConsent(client, gateway);
    const fetched = await client.callTool({ name: "abdm_health_info_request", arguments: fetchArgs(ids) });
    expect(fetched.structuredContent).toMatchObject({ sent: true, state: "requested" });
    expect(prompts.at(-1)).toContain("Record content will be returned to the requester");

    await gateway.runUntilIdle();
    const { transactionId } = fetched.structuredContent as { transactionId: string };
    const result = await client.callTool({ name: "abdm_health_info_result", arguments: { transactionId } });
    expect(result.structuredContent).toMatchObject({
      state: "received",
      contentExposed: true,
      truncated: false,
      records: [{ hiType: "Prescription", bundle: { resourceType: "Bundle", type: "document" } }],
    });
    expect((result.structuredContent as { notice: string }).notice).toMatch(/untrusted/);

    const overview = await client.callTool({ name: "abdm_workflow_status", arguments: {} });
    expect(overview.structuredContent).toMatchObject({
      consentRequests: [{ requestId: ids.requestId, state: "granted", artefactIds: [ids.artefactId] }],
      transfers: [{ transactionId, state: "received", recordCount: 1 }],
    });
  });

  it("returns only metadata when the deployment does not expose content", async () => {
    const { client, gateway } = await setup({ action: "accept", content: { confirm: true } }, { exposeContent: false });
    const ids = await grantedConsent(client, gateway);
    const fetched = await client.callTool({ name: "abdm_health_info_request", arguments: fetchArgs(ids) });
    await gateway.runUntilIdle();
    const { transactionId } = fetched.structuredContent as { transactionId: string };
    const result = await client.callTool({ name: "abdm_health_info_result", arguments: { transactionId } });
    const records = (result.structuredContent as { records: object[] }).records;
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty("bundle");
  });

  it("refuses a fetch outside the consent without asking the user", async () => {
    const { client, gateway, prompts } = await setup({ action: "accept", content: { confirm: true } });
    const ids = await grantedConsent(client, gateway);
    const before = prompts.length;
    const result = await client.callTool({ name: "abdm_health_info_request", arguments: { ...fetchArgs(ids), hiTypes: ["DischargeSummary"] } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("hi_type_not_consented");
    expect(prompts).toHaveLength(before);
  });

  it("builds a FHIR document that its own validator accepts, and reports broken ones", async () => {
    const { client } = await setup({ action: "decline" });
    const generated = await client.callTool({
      name: "abdm_fhir_generate",
      arguments: {
        hiType: "DiagnosticReport",
        patientAbhaAddress: "asha.rao1@sbx",
        practitionerName: "Dr Example",
        date: "2025-06-01T10:00:00.000Z",
        resources: [{ resourceType: "DiagnosticReport", status: "final", code: { text: "Complete blood count" } }],
      },
    });
    expect(generated.structuredContent).toMatchObject({ validation: { valid: true, hiType: "DiagnosticReport", issues: [] } });

    const { bundle } = generated.structuredContent as { bundle: { entry: unknown[] } };
    const broken = await client.callTool({ name: "abdm_fhir_validate", arguments: { bundle: { ...bundle, entry: bundle.entry.slice(0, 3) } } });
    expect(broken.structuredContent).toMatchObject({ valid: false, issues: [{ severity: "error", path: "Bundle.entry[0].resource.section[0].entry[0]" }] });
  });

  it("refuses mock scenarios outside the mock environment", () => {
    expect(() =>
      createAbdmMcpServer({
        workflows: {} as ConsentWorkflows,
        actor: { id: "a", hiuIds: [] },
        environment: "sandbox",
        hiuId: DEMO_HIU_ID,
        requesterName: "x",
        mock: { scenarios: {}, selectScenario: () => {} },
      }),
    ).toThrow(/only allowed in the mock environment/);
  });
});
