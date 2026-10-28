import { CONSENT_PURPOSES, err, HI_TYPES, ok, type AbdmEnvironment, type Clock, type DateRange, type HiType, type Result } from "@yellowparrottech/abdm-core";
import {
  applyConsentEvent,
  checkHealthInfoRequest,
  consentStateAt,
  createConsentTransaction,
  type ConsentArtefact,
  type ConsentRequestInput,
  type ConsentState,
  type PolicyDenial,
} from "@yellowparrottech/abdm-consent-engine";
import type { Actor } from "./actor.js";
import { ApprovalBook, type ApprovalError } from "./approvals.js";
import type { AuditEntry, AuditLog } from "./audit.js";
import type { ConsentCallback, ConsentGatewayPort } from "./gateway.js";
import type { ConsentStore } from "./store.js";

/** What a person must see before a consent request is sent. Approval is bound to exactly these parameters. */
export interface PendingApproval {
  approvalId: string;
  environment: AbdmEnvironment;
  summary: string[];
  expiresAt: string;
}

export interface ConsentStatus {
  requestId: string;
  consentRequestId?: string;
  state: ConsentState;
  artefacts: Pick<ConsentArtefact, "id" | "hipId" | "hiTypes" | "dateRange" | "expiresAt">[];
  updatedAt: string;
}

export type WorkflowError =
  | { code: "invalid_request"; detail: string }
  | { code: "forbidden" }
  | { code: "not_found" }
  | ApprovalError
  | PolicyDenial;

export interface ConsentWorkflowsOptions {
  environment: AbdmEnvironment;
  clock: Clock;
  store: ConsentStore;
  audit: AuditLog;
  gateway: ConsentGatewayPort;
  /** How long a person has to approve. */
  approvalTtlMs?: number;
  newId?: () => string;
}

/**
 * HIU consent workflows, independent of MCP. Every call names the authenticated actor;
 * authorisation, approvals and audit happen here, so no adapter can skip them.
 */
export class ConsentWorkflows {
  readonly #o: Required<ConsentWorkflowsOptions>;
  readonly #approvals: ApprovalBook<ConsentRequestInput>;
  readonly #changeListeners: ((requestId: string) => void)[] = [];

  constructor(options: ConsentWorkflowsOptions) {
    this.#o = { approvalTtlMs: 10 * 60_000, newId: () => crypto.randomUUID(), ...options };
    this.#approvals = new ApprovalBook(this.#o.clock, this.#o.approvalTtlMs, this.#o.newId);
  }

  /** Step 1: validate and authorise a consent request, and return what the person must approve. Nothing is sent yet. */
  prepareConsentRequest(actor: Actor, request: ConsentRequestInput): Result<PendingApproval, WorkflowError> {
    const invalid = this.#validate(request);
    if (invalid) return err({ code: "invalid_request", detail: invalid });
    if (!actor.hiuIds.includes(request.hiuId)) {
      this.#audit({ actorId: actor.id, action: "consent_approval_issued", outcome: "denied", reason: "actor not permitted for this HIU" });
      return err({ code: "forbidden" });
    }

    const { approvalId, expiresAt } = this.#approvals.issue(actor.id, request);
    this.#audit({ actorId: actor.id, action: "consent_approval_issued", outcome: "ok", hiTypes: request.hiTypes });

    return ok({ approvalId, environment: this.#o.environment, summary: summarise(request), expiresAt });
  }

  /**
   * Step 2: after the person approves, send exactly the approved request. Each approval works once.
   * Callers that relay the approval ID through an untrusted channel pass `expected`, the request they
   * are about to send, so an approval for different parameters is refused.
   */
  async submitApprovedConsentRequest(actor: Actor, approvalId: string, expected?: ConsentRequestInput): Promise<Result<ConsentStatus, WorkflowError>> {
    const approved = this.#approvals.redeem(actor.id, approvalId, expected);
    if (!approved.ok) return approved;
    const request = approved.value;
    // Time has passed since step 1, and the actor's permissions may have changed.
    const invalid = this.#validate(request);
    if (invalid) return err({ code: "invalid_request", detail: invalid });
    if (!actor.hiuIds.includes(request.hiuId)) {
      this.#audit({ actorId: actor.id, action: "consent_request_submitted", outcome: "denied", reason: "actor not permitted for this HIU" });
      return err({ code: "forbidden" });
    }

    const tx = createConsentTransaction(this.#o.newId(), request, this.#now().toISOString());
    this.#o.store.put({ ownerActorId: actor.id, tx });
    await this.#o.gateway.submitConsentRequest(tx.requestId, request);
    this.#audit({ actorId: actor.id, action: "consent_request_submitted", outcome: "ok", requestId: tx.requestId, hiTypes: request.hiTypes });

    return ok(this.#status(tx.requestId));
  }

  /** Apply a callback from the gateway. Unknown, replayed or invalid callbacks never change state. */
  handleConsentCallback(callback: ConsentCallback): void {
    const record = this.#o.store.get(callback.requestId);
    if (!record) {
      this.#audit({ action: "consent_callback", outcome: "rejected", requestId: callback.requestId, reason: "unknown request" });
      return;
    }
    const result = applyConsentEvent(record.tx, callback.event);
    if (!result.ok) {
      this.#audit({ action: "consent_callback", outcome: "rejected", requestId: callback.requestId, reason: result.error.code });
      return;
    }
    this.#o.store.put({ ...record, tx: result.value });
    const { consentRequestId } = result.value;
    this.#audit({ action: "consent_callback", outcome: "ok", requestId: callback.requestId, ...(consentRequestId ? { consentRequestId } : {}), reason: callback.event.type });
    for (const listener of this.#changeListeners) listener(callback.requestId);
  }

  /** Called after a callback changes a consent, so dependent data can be discarded when it lapses. */
  onConsentChange(listener: (requestId: string) => void): void {
    this.#changeListeners.push(listener);
  }

  /** Current state of a request the actor owns. Other actors' requests look the same as missing ones. */
  getConsentStatus(actor: Actor, requestId: string): Result<ConsentStatus, WorkflowError> {
    const record = this.#o.store.get(requestId);
    if (!record || record.ownerActorId !== actor.id) {
      this.#audit({ actorId: actor.id, action: "consent_status_read", outcome: "denied", requestId });
      return err({ code: "not_found" });
    }
    return ok(this.#status(requestId));
  }

  /** Every consent request this actor has made, oldest first. */
  listConsentRequests(actor: Actor): ConsentStatus[] {
    return this.#o.store.listByOwner(actor.id).map((r) => this.#status(r.tx.requestId));
  }

  /** Check a health-information request against the consent before any data is requested. */
  authoriseHealthInfoRequest(
    actor: Actor,
    requestId: string,
    req: { artefactId: string; hiTypes: HiType[]; dateRange: DateRange },
  ): Result<ConsentArtefact, WorkflowError> {
    const record = this.#o.store.get(requestId);
    if (!record || record.ownerActorId !== actor.id) {
      this.#audit({ actorId: actor.id, action: "health_info_authorised", outcome: "denied", requestId, reason: "not_found" });
      return err({ code: "not_found" });
    }
    if (!actor.hiuIds.includes(record.tx.request.hiuId)) {
      this.#audit({ actorId: actor.id, action: "health_info_authorised", outcome: "denied", requestId, reason: "actor no longer permitted for this HIU" });
      return err({ code: "forbidden" });
    }
    const invalid = validateFetchShape(req);
    if (invalid) return err({ code: "invalid_request", detail: invalid });
    const result = checkHealthInfoRequest(record.tx, { ...req, hiuId: record.tx.request.hiuId }, this.#now());
    this.#audit({
      actorId: actor.id,
      action: "health_info_authorised",
      outcome: result.ok ? "ok" : "denied",
      requestId,
      hiTypes: req.hiTypes,
      ...(result.ok ? {} : { reason: result.error.code }),
    });
    return result;
  }

  /** Whether a fetch would still be inside the consent now. No actor checks and no audit; for internal clean-up. */
  isStillAuthorised(requestId: string, req: { artefactId: string; hiTypes: HiType[]; dateRange: DateRange }): boolean {
    const record = this.#o.store.get(requestId);
    return !!record && checkHealthInfoRequest(record.tx, { ...req, hiuId: record.tx.request.hiuId }, this.#now()).ok;
  }

  #status(requestId: string): ConsentStatus {
    const { tx } = this.#o.store.get(requestId)!;
    return {
      requestId: tx.requestId,
      ...(tx.consentRequestId ? { consentRequestId: tx.consentRequestId } : {}),
      state: consentStateAt(tx, this.#now()),
      artefacts: tx.artefacts.map(({ id, hipId, hiTypes, dateRange, expiresAt }) => ({ id, hipId, hiTypes, dateRange, expiresAt })),
      updatedAt: tx.updatedAt,
    };
  }

  #validate(r: ConsentRequestInput): string | undefined {
    if (r.hiTypes.length === 0) return "at least one HI type is required";
    const unknown = r.hiTypes.filter((t) => !(HI_TYPES as readonly string[]).includes(t));
    if (unknown.length > 0) return `unknown HI types: ${unknown.join(", ")}`;
    if (!Object.hasOwn(CONSENT_PURPOSES, r.purpose)) return `unknown purpose: ${r.purpose}`;
    const from = Date.parse(r.dateRange.from);
    const to = Date.parse(r.dateRange.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) return "dateRange must have valid dates with from before to";
    const expiry = Date.parse(r.expiresAt);
    if (Number.isNaN(expiry) || expiry <= this.#now().getTime()) return "expiresAt must be a future date";
    return undefined;
  }

  #now(): Date {
    return this.#o.clock.now();
  }

  #audit(entry: Omit<AuditEntry, "at">): void {
    this.#o.audit.append({ at: this.#now().toISOString(), ...entry, ...(entry.requestId === undefined ? {} : { requestId: safeId(entry.requestId) }) });
  }
}

/** IDs reach the audit log from callers; keep only well-formed ones so the log cannot be filled with arbitrary text. */
export function safeId(id: string): string {
  return /^[\w:.-]{1,128}$/.test(id) ? id : "<invalid id>";
}

function validateFetchShape(req: { hiTypes: HiType[]; dateRange: DateRange }): string | undefined {
  if (req.hiTypes.length === 0) return "at least one HI type is required";
  const from = Date.parse(req.dateRange.from);
  const to = Date.parse(req.dateRange.to);
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) return "dateRange must have valid dates with from before to";
  return undefined;
}

function summarise(r: ConsentRequestInput): string[] {
  const day = (iso: string) => iso.slice(0, 10);
  return [
    `Request consent from ${r.patientAbhaAddress} for ${CONSENT_PURPOSES[r.purpose]}`,
    `Records: ${r.hiTypes.join(", ")}`,
    `Period: ${day(r.dateRange.from)} to ${day(r.dateRange.to)}`,
    `Access ends: ${day(r.expiresAt)}`,
    `Requested by: ${r.requesterName} for ${r.hiuId}`,
  ];
}
