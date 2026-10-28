import { err, ok, type AbdmEnvironment, type Clock, type DataPush, type DateRange, type HiType, type HealthInfoGatewayRequest, type Result } from "@yellowparrottech/abdm-core";
import { decryptToString, generateKeyMaterial, type KeyMaterial } from "@yellowparrottech/abdm-crypto";
import type { Actor } from "./actor.js";
import { ApprovalBook } from "./approvals.js";
import type { AuditLog } from "./audit.js";
import type { ConsentWorkflows, PendingApproval, WorkflowError } from "./consent-workflows.js";

/** Sends health-information requests to ABDM. Records come back through `handleDataPush`. */
export interface HealthInfoGatewayPort {
  requestHealthInfo(transactionId: string, request: HealthInfoGatewayRequest): void | Promise<void>;
}

export interface HealthInfoRequestInput {
  /** The consent request the artefact was granted under. */
  requestId: string;
  artefactId: string;
  hiTypes: HiType[];
  dateRange: DateRange;
}

/** `discarded`: the consent lapsed, so any records were deleted and no more are accepted. */
export type TransferState = "requested" | "received" | "failed" | "discarded";

export interface ReceivedRecord {
  hiType: HiType;
  careContextReference: string;
  /** Decrypted FHIR bundle. Present only when this deployment may expose record content. */
  bundle?: unknown;
  sizeBytes: number;
}

export interface HealthInfoResult {
  transactionId: string;
  state: TransferState;
  records: ReceivedRecord[];
  /** Whether `bundle` is included; false means metadata only. */
  contentExposed: boolean;
  failure?: string;
}

export interface HealthInfoWorkflowsOptions {
  environment: AbdmEnvironment;
  clock: Clock;
  audit: AuditLog;
  gateway: HealthInfoGatewayPort;
  consents: ConsentWorkflows;
  /**
   * Return decrypted record content to callers. Allowed in `mock` (synthetic data) or when the
   * operator declares a controlled deployment; otherwise callers see metadata only.
   */
  exposeContent?: boolean;
  controlledDeployment?: boolean;
  approvalTtlMs?: number;
  /** How long the HIU's key material stays valid. */
  keyTtlMs?: number;
  newId?: () => string;
}

interface Transfer {
  ownerActorId: string;
  input: HealthInfoRequestInput;
  keys: KeyMaterial;
  keyExpiresAt: number;
  /** Set as soon as a push is accepted for processing, so a second push is refused even mid-decryption. */
  pushAccepted: boolean;
  state: TransferState;
  records: (ReceivedRecord & { bundle: unknown })[];
  failure?: string;
}

/**
 * HIU health-information fetches. Each fetch is authorised against the consent, approved by a
 * person, and decrypted server-side with a key pair made for that transfer; the private key never
 * leaves this class.
 */
export class HealthInfoWorkflows {
  readonly #o: Required<Omit<HealthInfoWorkflowsOptions, "controlledDeployment">>;
  readonly #approvals: ApprovalBook<HealthInfoRequestInput>;
  readonly #transfers = new Map<string, Transfer>();

  constructor(options: HealthInfoWorkflowsOptions) {
    if (options.exposeContent && options.environment !== "mock" && !options.controlledDeployment) {
      throw new Error("Record content can only be exposed in the mock environment or a declared controlled deployment");
    }
    this.#o = { exposeContent: false, approvalTtlMs: 10 * 60_000, keyTtlMs: 60 * 60_000, newId: () => crypto.randomUUID(), ...options };
    this.#approvals = new ApprovalBook(this.#o.clock, this.#o.approvalTtlMs, this.#o.newId);
    this.#o.consents.onConsentChange(() => this.discardLapsed());
  }

  /**
   * Delete records, and stop accepting pushes, for every transfer whose consent no longer covers it
   * (revoked, expired or narrowed). Runs on consent changes and before reads; hosts should also call it
   * periodically so time-based expiry is enforced without a read.
   */
  discardLapsed(): void {
    for (const transfer of this.#transfers.values()) {
      if (transfer.state === "failed" || transfer.state === "discarded") continue;
      if (this.#o.consents.isStillAuthorised(transfer.input.requestId, transfer.input)) continue;
      this.#discard(transfer);
    }
  }

  /** Step 1: authorise against the consent and return what the person must approve. Nothing is sent yet. */
  prepareHealthInfoRequest(actor: Actor, input: HealthInfoRequestInput): Result<PendingApproval, WorkflowError> {
    const authorised = this.#o.consents.authoriseHealthInfoRequest(actor, input.requestId, input);
    if (!authorised.ok) return authorised;
    const { approvalId, expiresAt } = this.#approvals.issue(actor.id, input);
    const day = (iso: string) => iso.slice(0, 10);
    return ok({
      approvalId,
      environment: this.#o.environment,
      expiresAt,
      summary: [
        `Fetch health records from ${authorised.value.hipId} under consent ${input.artefactId}`,
        `Records: ${input.hiTypes.join(", ")}`,
        `Period: ${day(input.dateRange.from)} to ${day(input.dateRange.to)}`,
        this.#o.exposeContent ? "Record content will be returned to the requester" : "Only record metadata will be returned to the requester",
      ],
    });
  }

  /** Step 2: after approval, re-check the consent and send the request with fresh key material. */
  async submitApprovedHealthInfoRequest(
    actor: Actor,
    approvalId: string,
    expected?: HealthInfoRequestInput,
  ): Promise<Result<HealthInfoResult, WorkflowError>> {
    const approved = this.#approvals.redeem(actor.id, approvalId, expected);
    if (!approved.ok) return approved;
    const input = approved.value;
    // The consent may have changed since step 1.
    const authorised = this.#o.consents.authoriseHealthInfoRequest(actor, input.requestId, input);
    if (!authorised.ok) return authorised;

    const transactionId = this.#o.newId();
    const keys = generateKeyMaterial();
    const keyExpiresAt = this.#o.clock.now().getTime() + this.#o.keyTtlMs;
    this.#transfers.set(transactionId, { ownerActorId: actor.id, input, keys, keyExpiresAt, pushAccepted: false, state: "requested", records: [] });
    await this.#o.gateway.requestHealthInfo(transactionId, {
      consentArtefactId: input.artefactId,
      hiTypes: input.hiTypes,
      dateRange: input.dateRange,
      keyMaterial: { publicKey: keys.x509PublicKey, nonce: keys.nonce, expiresAt: new Date(keyExpiresAt).toISOString() },
    });
    this.#audit({ actorId: actor.id, action: "health_info_requested", outcome: "ok", requestId: input.requestId, hiTypes: input.hiTypes });
    return ok(this.#result(transactionId));
  }

  /**
   * Decrypt and store records pushed by a HIP. Only the first push for a transfer is processed;
   * unknown, repeated, late or undecryptable pushes are rejected. ABDM's encryption does not prove
   * who sent a push, so the host must deliver only pushes it received from the gateway (see the
   * callback bridge), and transaction IDs are random so they cannot be guessed.
   */
  async handleDataPush(push: DataPush): Promise<void> {
    const transfer = this.#transfers.get(push.transactionId);
    if (!transfer || transfer.pushAccepted || transfer.state !== "requested") {
      const reason = !transfer ? "unknown transfer" : transfer.state === "requested" ? "a push is already being processed" : `transfer already ${transfer.state}`;
      this.#audit({ action: "health_info_received", outcome: "rejected", reason });
      return;
    }
    // Claim the transfer before any await, so a concurrent push cannot also be processed.
    transfer.pushAccepted = true;
    if (this.#o.clock.now().getTime() > transfer.keyExpiresAt) return this.#fail(transfer, "key material expired before the records arrived");
    if (!this.#o.consents.isStillAuthorised(transfer.input.requestId, transfer.input)) return this.#discard(transfer);
    const unexpected = push.entries.filter((e) => !transfer.input.hiTypes.includes(e.hiType));
    if (unexpected.length > 0) return this.#fail(transfer, "pushed record types that were not requested");

    try {
      transfer.records = await Promise.all(
        push.entries.map(async (entry) => {
          const json = await decryptToString({
            encryptedData: entry.content,
            receiverPrivateKey: transfer.keys.privateKey,
            receiverNonce: transfer.keys.nonce,
            senderPublicKey: push.keyMaterial.publicKey,
            senderNonce: push.keyMaterial.nonce,
          });
          return { hiType: entry.hiType, careContextReference: entry.careContextReference, sizeBytes: new TextEncoder().encode(json).length, bundle: JSON.parse(json) as unknown };
        }),
      );
    } catch {
      return this.#fail(transfer, "records could not be decrypted or parsed");
    }
    // Decryption is asynchronous; the consent may have lapsed meanwhile.
    if (!this.#o.consents.isStillAuthorised(transfer.input.requestId, transfer.input)) return this.#discard(transfer);
    transfer.state = "received";
    this.#forgetPrivateKey(transfer);
    this.#audit({ action: "health_info_received", outcome: "ok", requestId: transfer.input.requestId, hiTypes: transfer.records.map((r) => r.hiType) });
  }

  /**
   * Records from a transfer the actor owns. Consent is checked again on every read; once it is
   * no longer valid, stored records are discarded and nothing is returned.
   */
  getHealthInfoResult(actor: Actor, transactionId: string): Result<HealthInfoResult, WorkflowError> {
    const transfer = this.#transfers.get(transactionId);
    if (!transfer || transfer.ownerActorId !== actor.id) return err({ code: "not_found" });
    const stillAllowed = this.#o.consents.authoriseHealthInfoRequest(actor, transfer.input.requestId, transfer.input);
    if (!stillAllowed.ok) {
      if (stillAllowed.error.code !== "forbidden") this.#discard(transfer);
      return stillAllowed;
    }
    this.#audit({ actorId: actor.id, action: "health_info_read", outcome: "ok", requestId: transfer.input.requestId, hiTypes: transfer.records.map((r) => r.hiType) });
    return ok(this.#result(transactionId));
  }

  /** This actor's transfers with their state and record counts; no record content. */
  listTransfers(actor: Actor): { transactionId: string; requestId: string; state: TransferState; recordCount: number; failure?: string }[] {
    this.discardLapsed();
    return [...this.#transfers.entries()]
      .filter(([, t]) => t.ownerActorId === actor.id)
      .map(([transactionId, t]) => ({
        transactionId,
        requestId: t.input.requestId,
        state: t.state,
        recordCount: t.records.length,
        ...(t.failure ? { failure: t.failure } : {}),
      }));
  }

  #result(transactionId: string): HealthInfoResult {
    const t = this.#transfers.get(transactionId)!;
    return {
      transactionId,
      state: t.state,
      contentExposed: this.#o.exposeContent,
      records: t.records.map(({ bundle, ...meta }) => (this.#o.exposeContent ? { ...meta, bundle } : meta)),
      ...(t.failure ? { failure: t.failure } : {}),
    };
  }

  /** A transfer's private key is only needed until its one push is processed. */
  #forgetPrivateKey(transfer: Transfer): void {
    transfer.keys = { ...transfer.keys, privateKey: "" };
  }

  #discard(transfer: Transfer): void {
    this.#forgetPrivateKey(transfer);
    transfer.state = "discarded";
    transfer.records = [];
    transfer.pushAccepted = true;
    this.#audit({ action: "health_info_discarded", outcome: "ok", requestId: transfer.input.requestId, reason: "consent no longer covers this transfer" });
  }

  #fail(transfer: Transfer, reason: string): void {
    this.#forgetPrivateKey(transfer);
    transfer.state = "failed";
    transfer.failure = reason;
    transfer.records = [];
    this.#audit({ action: "health_info_received", outcome: "rejected", requestId: transfer.input.requestId, reason });
  }

  #audit(entry: Omit<Parameters<AuditLog["append"]>[0], "at">): void {
    this.#o.audit.append({ at: this.#o.clock.now().toISOString(), ...entry });
  }
}
