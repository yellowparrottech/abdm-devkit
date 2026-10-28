#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMockRuntime, runInRealTime } from "./runtime.js";

const environment = process.env.ABDM_ENV ?? "mock";
if (environment !== "mock") {
  console.error(`ABDM_ENV=${environment} is not available yet. This release runs the mock environment only; sandbox support is planned for v0.5.`);
  process.exit(1);
}

// ABDM_MOCK_FAST=1 shortens the simulated delays, for automated tests.
const fast = process.env.ABDM_MOCK_FAST === "1";
const runtime = createMockRuntime(fast ? { ackDelayMs: 10, decisionDelayMs: 50, dataPushDelayMs: 50 } : {});
runInRealTime(runtime, fast ? 10 : 250);
serveStdio(runtime.createServer);
// stdout carries the protocol, so status goes to stderr.
console.error("YellowParrot ABDM DevKit MCP server running in mock mode. All data is synthetic.");
