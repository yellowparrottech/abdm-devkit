import { err, ok, type Result } from "@yellowparrottech/abdm-core";
import type { ConsentArtefact, ConsentEvent, ConsentEventType, ConsentRequestInput, ConsentState, ConsentTransaction } from "./types.js";

export type TransitionError =
  | { code: "invalid_transition"; from: ConsentState; event: ConsentEventType }
  | { code: "artefact_exceeds_request"; artefactId: string; detail: string };

// Callbacks can arrive out of order (a notification before the acknowledgement), so a
// decision is accepted straight from `requested` as well as from `pending_patient`.
const TRANSITIONS: Record<ConsentState, Partial<Record<ConsentEventType, ConsentState>>> = {
  requested: { acknowledged: "pending_patient", granted: "granted", denied: "denied", expired: "expired", failed: "failed" },
  pending_patient: { granted: "granted", denied: "denied", expired: "expired", failed: "failed" },
  granted: { revoked: "revoked", expired: "expired" },
  denied: {},
  expired: {},
  revoked: {},
  failed: {},
};

export function createConsentTransaction(requestId: string, request: ConsentRequestInput, at: string): ConsentTransaction {
  return { requestId, request, state: "requested", artefacts: [], appliedEventIds: [], updatedAt: at };
}

export function applyConsentEvent(tx: ConsentTransaction, event: ConsentEvent): Result<ConsentTransaction, TransitionError> {
  if (tx.appliedEventIds.includes(event.eventId)) return ok(tx);

  const base = { ...tx, appliedEventIds: [...tx.appliedEventIds, event.eventId], updatedAt: event.at };

  // A late acknowledgement only records the gateway's ID.
  if (event.type === "acknowledged" && tx.state !== "requested") {
    return ok({ ...base, consentRequestId: tx.consentRequestId ?? event.consentRequestId });
  }

  const next = TRANSITIONS[tx.state][event.type];
  if (next === undefined) return err({ code: "invalid_transition", from: tx.state, event: event.type });

  switch (event.type) {
    case "acknowledged":
      return ok({ ...base, state: next, consentRequestId: event.consentRequestId });
    case "granted": {
      for (const artefact of event.artefacts) {
        const problem = exceedsRequest(artefact, tx.request);
        if (problem) return err({ code: "artefact_exceeds_request", artefactId: artefact.id, detail: problem });
      }
      return ok({ ...base, state: next, artefacts: event.artefacts });
    }
    case "failed":
      return ok({ ...base, state: next, failure: { code: event.code, message: event.message } });
    default:
      return ok({ ...base, state: next });
  }
}

/** State as of `now`: a grant whose artefacts have all expired counts as expired. */
export function consentStateAt(tx: ConsentTransaction, now: Date): ConsentState {
  // An unreadable expiry counts as expired, never as open-ended.
  if (tx.state === "granted" && tx.artefacts.every((a) => !(Date.parse(a.expiresAt) > now.getTime()))) return "expired";
  return tx.state;
}

function exceedsRequest(artefact: ConsentArtefact, request: ConsentRequestInput): string | undefined {
  const dates = [artefact.dateRange.from, artefact.dateRange.to, artefact.expiresAt];
  if (dates.some((d) => Number.isNaN(Date.parse(d)))) return "dates are not valid ISO 8601";
  if (Date.parse(artefact.dateRange.from) > Date.parse(artefact.dateRange.to)) return "date range ends before it starts";
  if (artefact.hiuId !== request.hiuId) return "granted to a different HIU";
  if (artefact.purpose !== request.purpose) return "purpose differs from the request";
  const extra = artefact.hiTypes.filter((t) => !request.hiTypes.includes(t));
  if (extra.length > 0) return `HI types not requested: ${extra.join(", ")}`;
  if (Date.parse(artefact.dateRange.from) < Date.parse(request.dateRange.from) || Date.parse(artefact.dateRange.to) > Date.parse(request.dateRange.to)) {
    return "date range wider than requested";
  }
  if (Date.parse(artefact.expiresAt) > Date.parse(request.expiresAt)) return "expires later than requested";
  return undefined;
}
