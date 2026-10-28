import { ManualClock } from "@yellowparrottech/abdm-core";
import { DEMO_HIP_ID, DEMO_HIU_ID } from "@yellowparrottech/abdm-fixtures";
import { createAbdmMcpServer } from "@yellowparrottech/abdm-mcp-adapter";
import { CONSENT_SCENARIOS, MockGateway, type ConsentScenario } from "@yellowparrottech/abdm-mock-gateway";
import { ConsentWorkflows, HealthInfoWorkflows, InMemoryAuditLog, InMemoryConsentStore, type Actor } from "@yellowparrottech/abdm-workflows";

/** The single local user of a mock server. Real deployments set the actor from their own authentication. */
export const LOCAL_ACTOR: Actor = { id: "local-user", hiuIds: [DEMO_HIU_ID] };

export interface MockRuntimeOptions {
  /** Simulated time; defaults to a clock starting now. */
  clock?: ManualClock;
  /** Delays chosen so a live demo shows each step: acknowledgement, patient decision, record push. */
  ackDelayMs?: number;
  decisionDelayMs?: number;
  dataPushDelayMs?: number;
}

/** Everything a mock-mode server needs, wired together, with synthetic data only. */
export function createMockRuntime(options: MockRuntimeOptions = {}) {
  const clock = options.clock ?? new ManualClock(new Date());
  const gateway = new MockGateway({
    clock,
    hipId: DEMO_HIP_ID,
    ackDelayMs: options.ackDelayMs ?? 500,
    decisionDelayMs: options.decisionDelayMs ?? 4_000,
    dataPushDelayMs: options.dataPushDelayMs ?? 3_000,
  });
  const audit = new InMemoryAuditLog();
  let scenario: ConsentScenario = "approve";

  const consents = new ConsentWorkflows({
    environment: "mock",
    clock,
    audit,
    store: new InMemoryConsentStore(),
    gateway: { submitConsentRequest: (requestId, request) => void gateway.requestConsent(requestId, request, scenario) },
  });
  const healthInfo = new HealthInfoWorkflows({
    environment: "mock",
    clock,
    audit,
    consents,
    exposeContent: true,
    gateway: { requestHealthInfo: (transactionId, request) => gateway.requestHealthInfo(transactionId, request) },
  });
  gateway.onCallback((callback) => consents.handleConsentCallback(callback));
  gateway.onDataPush((push) => healthInfo.handleDataPush(push));

  const createServer = () =>
    createAbdmMcpServer({
      workflows: consents,
      healthInfo,
      actor: LOCAL_ACTOR,
      environment: "mock",
      hiuId: DEMO_HIU_ID,
      requesterName: "Local developer",
      mock: {
        scenarios: CONSENT_SCENARIOS,
        selectScenario: (name) => {
          scenario = name as ConsentScenario;
        },
      },
    });

  return { clock, gateway, audit, consents, healthInfo, createServer };
}

/**
 * Advance simulated time with the wall clock, so callbacks arrive while a person watches, and discard
 * records whose consent has lapsed on each tick.
 */
export function runInRealTime(runtime: { gateway: MockGateway; healthInfo: HealthInfoWorkflows }, tickMs = 250): () => void {
  const { gateway, healthInfo } = runtime;
  let last = Date.now();
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    const now = Date.now();
    const elapsed = now - last;
    last = now;
    gateway
      .advance(elapsed)
      .then(() => healthInfo.discardLapsed())
      .finally(() => {
        busy = false;
      });
  }, tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
