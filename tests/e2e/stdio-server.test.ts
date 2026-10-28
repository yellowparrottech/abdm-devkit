import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the built server as a separate process over stdio, as Claude Desktop does. Needs `pnpm build` first.
// Set ABDM_E2E_SERVER=mcpb/server/index.js to test the bundled extension instead.
const serverPath = process.env.ABDM_E2E_SERVER ?? fileURLToPath(new URL("../../apps/mcp-server/dist/main.js", import.meta.url));

describe.skipIf(!existsSync(serverPath))("MCP server over stdio", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "e2e", version: "0.0.0" }, { capabilities: { elicitation: { form: {} } } });
    client.setRequestHandler("elicitation/create", async () => ({ action: "accept", content: { confirm: true } }));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ABDM_MOCK_FAST: "1" }, stderr: "ignore" }));
  });

  afterAll(async () => {
    await client?.close();
  });

  async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const value = await read();
      if (done(value)) return value;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("Timed out waiting for the mock gateway");
  }

  it("runs consent, encrypted transfer and decryption against the real process", async () => {
    const range = { dateFrom: "2025-01-01T00:00:00.000Z", dateTo: "2025-12-31T00:00:00.000Z" };
    const sent = await client.callTool({
      name: "abdm_consent_request",
      arguments: { patientAbhaAddress: "asha.rao1@sbx", purpose: "CAREMGT", hiTypes: ["Prescription"], ...range, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    const { requestId } = (sent.structuredContent as { status: { requestId: string } }).status;

    const status = await waitFor(
      () => client.callTool({ name: "abdm_consent_status", arguments: { requestId } }),
      (r) => (r.structuredContent as { state: string }).state === "granted",
    );
    const artefactId = (status.structuredContent as { artefacts: { id: string }[] }).artefacts[0]!.id;

    const fetched = await client.callTool({ name: "abdm_health_info_request", arguments: { requestId, artefactId, hiTypes: ["Prescription"], ...range } });
    const { transactionId } = fetched.structuredContent as { transactionId: string };

    const result = await waitFor(
      () => client.callTool({ name: "abdm_health_info_result", arguments: { transactionId } }),
      (r) => (r.structuredContent as { state: string }).state === "received",
    );
    expect(result.structuredContent).toMatchObject({ records: [{ hiType: "Prescription", bundle: { resourceType: "Bundle" } }] });
  });
});
