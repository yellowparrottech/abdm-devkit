import type { DataPush, HealthInfoGatewayRequest, ManualClock } from "@yellowparrottech/abdm-core";
import type { ConsentArtefact, ConsentEvent, ConsentRequestInput } from "@yellowparrottech/abdm-consent-engine";
import { encrypt, generateKeyMaterial } from "@yellowparrottech/abdm-crypto";
import { syntheticRecords } from "@yellowparrottech/abdm-fixtures";

/** How the simulated patient and gateway behave for one consent request. */
export const CONSENT_SCENARIOS = {
  approve: "Patient approves everything requested",
  approve_narrower: "Patient approves only the first HI type requested",
  deny: "Patient denies the request",
  expire: "Patient never answers and the request expires",
  lost_notification: "Patient approves but the consent notification is never delivered",
  duplicate_notification: "The consent notification is delivered twice",
  late_acknowledgement: "The approval arrives before the gateway's acknowledgement",
} as const;
export type ConsentScenario = keyof typeof CONSENT_SCENARIOS;

export interface ConsentCallback {
  requestId: string;
  event: ConsentEvent;
}

export interface MockGatewayOptions {
  clock: ManualClock;
  hipId: string;
  /** Delay before the gateway acknowledges a request. */
  ackDelayMs?: number;
  /** Delay before the simulated patient decides. */
  decisionDelayMs?: number;
  /** Delay before the simulated HIP pushes requested records. */
  dataPushDelayMs?: number;
}

type Delivery = { kind: "consent"; callback: ConsentCallback } | { kind: "data"; prepare: () => Promise<DataPush> };

interface Scheduled {
  dueAt: number;
  order: number;
  delivery: Delivery;
}

/**
 * Simulates the ABDM gateway and one HIP on simulated time. For consent it acknowledges the
 * request and delivers the patient's decision; for health information it encrypts synthetic
 * records for the HIU's key and pushes them. Callbacks are domain events; V2 and V3 wire
 * formats are added with the client adapters.
 */
export class MockGateway {
  readonly #clock: ManualClock;
  readonly #hipId: string;
  readonly #ackDelayMs: number;
  readonly #decisionDelayMs: number;
  readonly #dataPushDelayMs: number;
  readonly #queue: Scheduled[] = [];
  readonly #consentListeners: ((callback: ConsentCallback) => void)[] = [];
  readonly #dataListeners: ((push: DataPush) => void | Promise<void>)[] = [];
  readonly #artefactPatients = new Map<string, string>();
  #counter = 0;
  #order = 0;

  constructor(options: MockGatewayOptions) {
    this.#clock = options.clock;
    this.#hipId = options.hipId;
    this.#ackDelayMs = options.ackDelayMs ?? 500;
    this.#decisionDelayMs = options.decisionDelayMs ?? 30_000;
    this.#dataPushDelayMs = options.dataPushDelayMs ?? 5_000;
  }

  onCallback(listener: (callback: ConsentCallback) => void): void {
    this.#consentListeners.push(listener);
  }

  onDataPush(listener: (push: DataPush) => void | Promise<void>): void {
    this.#dataListeners.push(listener);
  }

  requestConsent(requestId: string, request: ConsentRequestInput, scenario: ConsentScenario): { consentRequestId: string } {
    const consentRequestId = `mock-cr-${++this.#counter}`;
    const ack = this.#event(consentRequestId, "ack", { type: "acknowledged", consentRequestId });
    const artefact = (hiTypes: ConsentArtefact["hiTypes"]): ConsentArtefact => {
      const id = `${consentRequestId}-artefact-1`;
      this.#artefactPatients.set(id, request.patientAbhaAddress);
      return { id, hipId: this.#hipId, hiuId: request.hiuId, purpose: request.purpose, hiTypes, dateRange: request.dateRange, expiresAt: request.expiresAt };
    };
    const granted = () => this.#event(consentRequestId, "decision", { type: "granted", artefacts: [artefact(request.hiTypes)] });
    const decisionAt = this.#ackDelayMs + this.#decisionDelayMs;
    const consent = (event: ConsentEvent, delayMs: number) => this.#schedule({ kind: "consent", callback: { requestId, event } }, delayMs);

    switch (scenario) {
      case "approve":
      case "lost_notification":
        consent(ack, this.#ackDelayMs);
        if (scenario === "approve") consent(granted(), decisionAt);
        break;
      case "approve_narrower":
        consent(ack, this.#ackDelayMs);
        consent(this.#event(consentRequestId, "decision", { type: "granted", artefacts: [artefact(request.hiTypes.slice(0, 1))] }), decisionAt);
        break;
      case "deny":
        consent(ack, this.#ackDelayMs);
        consent(this.#event(consentRequestId, "decision", { type: "denied" }), decisionAt);
        break;
      case "expire":
        consent(ack, this.#ackDelayMs);
        consent(this.#event(consentRequestId, "decision", { type: "expired" }), decisionAt);
        break;
      case "duplicate_notification": {
        const event = granted();
        consent(ack, this.#ackDelayMs);
        consent(event, decisionAt);
        consent(event, decisionAt + 1_000);
        break;
      }
      case "late_acknowledgement":
        consent(granted(), this.#ackDelayMs);
        consent(ack, decisionAt);
        break;
    }
    return { consentRequestId };
  }

  /** The simulated HIP encrypts synthetic records for the HIU's key and pushes them after a delay. */
  requestHealthInfo(transactionId: string, request: HealthInfoGatewayRequest): void {
    const patient = this.#artefactPatients.get(request.consentArtefactId);
    if (!patient) throw new Error(`Unknown consent artefact: ${request.consentArtefactId}`);
    this.#schedule(
      {
        kind: "data",
        prepare: async () => {
          const hip = generateKeyMaterial();
          const records = syntheticRecords(patient, request.hiTypes, request.dateRange);
          const entries = await Promise.all(
            records.map(async (r) => ({
              careContextReference: r.careContextReference,
              hiType: r.hiType,
              media: "application/fhir+json" as const,
              content: await encrypt({
                plaintext: JSON.stringify(r.bundle),
                senderPrivateKey: hip.privateKey,
                senderNonce: hip.nonce,
                receiverPublicKey: request.keyMaterial.publicKey,
                receiverNonce: request.keyMaterial.nonce,
              }),
            })),
          );
          return { transactionId, entries, keyMaterial: { publicKey: hip.x509PublicKey, nonce: hip.nonce } };
        },
      },
      this.#dataPushDelayMs,
    );
  }

  /** Callbacks scheduled but not yet delivered. */
  pendingCount(): number {
    return this.#queue.length;
  }

  /** Move simulated time forward and deliver every callback that falls due, in order. */
  async advance(ms: number): Promise<void> {
    const until = this.#clock.now().getTime() + ms;
    for (let next = this.#nextDue(until); next; next = this.#nextDue(until)) {
      this.#clock.advance(next.dueAt - this.#clock.now().getTime());
      await this.#deliver(next.delivery);
    }
    this.#clock.advance(until - this.#clock.now().getTime());
  }

  /** Deliver everything still scheduled, including anything scheduled while delivering. */
  async runUntilIdle(): Promise<void> {
    while (this.#queue.length > 0) {
      const last = Math.max(...this.#queue.map((s) => s.dueAt));
      await this.advance(Math.max(0, last - this.#clock.now().getTime()));
    }
  }

  async #deliver(delivery: Delivery): Promise<void> {
    if (delivery.kind === "consent") {
      for (const listener of this.#consentListeners) listener(delivery.callback);
      return;
    }
    const push = await delivery.prepare();
    for (const listener of this.#dataListeners) await listener(push);
  }

  #nextDue(until: number): Scheduled | undefined {
    this.#queue.sort((a, b) => a.dueAt - b.dueAt || a.order - b.order);
    if (this.#queue[0] && this.#queue[0].dueAt <= until) return this.#queue.shift();
    return undefined;
  }

  #schedule(delivery: Delivery, delayMs: number): void {
    const dueAt = this.#clock.now().getTime() + delayMs;
    if (delivery.kind === "consent") delivery.callback.event = { ...delivery.callback.event, at: new Date(dueAt).toISOString() };
    this.#queue.push({ dueAt, order: this.#order++, delivery });
  }

  #event<E extends Omit<ConsentEvent, "eventId" | "at">>(consentRequestId: string, kind: string, body: E): ConsentEvent {
    return { ...body, eventId: `${consentRequestId}:${kind}`, at: "" } as ConsentEvent;
  }
}
