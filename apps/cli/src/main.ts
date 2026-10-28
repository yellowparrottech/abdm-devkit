#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { createMockRuntime, LOCAL_ACTOR, runInRealTime } from "@yellowparrottech/abdm-mcp-server";
import { createRestApp } from "@yellowparrottech/abdm-rest-adapter";

const USAGE = `Usage: abdm-devkit <command>

Commands:
  mock [--port 8787]   Run the mock ABDM environment as a local REST API (synthetic data only)
  help                 Show this message`;

const [command, ...rest] = process.argv.slice(2);

if (command === "mock") {
  const { values } = parseArgs({ args: rest, options: { port: { type: "string", default: "8787" } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`Invalid port: ${values.port}`);
    process.exit(1);
  }

  const runtime = createMockRuntime();
  runInRealTime(runtime);
  // A fresh token each run, so other local processes cannot call the API by guessing.
  const token = randomBytes(24).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  const isValid = (header: string | null) => {
    const given = Buffer.from(header ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  const app = createRestApp({
    consents: runtime.consents,
    healthInfo: runtime.healthInfo,
    authenticate: (request) => (isValid(request.headers.get("authorization")) ? LOCAL_ACTOR : undefined),
  });

  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(`Mock ABDM environment (synthetic data only) at http://127.0.0.1:${port}/v1`);
    console.log(`ABDM_DEVKIT_TOKEN=${token}`);
    console.log(`Facility ID for consent requests: ${LOCAL_ACTOR.hiuIds[0]}`);
  });
} else if (command === undefined || command === "help" || command === "--help") {
  console.log(USAGE);
} else {
  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}
