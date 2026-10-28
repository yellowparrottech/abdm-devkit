import type { ConsentPurpose, DateRange, HiType } from "@yellowparrottech/abdm-core";

/** What an HIU asks the patient to approve. */
export interface ConsentRequestInput {
  patientAbhaAddress: string;
  hiuId: string;
  requesterName: string;
  purpose: ConsentPurpose;
  hiTypes: HiType[];
  /** Period of records requested. */
  dateRange: DateRange;
  /** When access granted under this consent must end. */
  expiresAt: string;
}

/** What the patient actually granted for one HIP; may be narrower than the request, never wider. */
export interface ConsentArtefact {
  id: string;
  hipId: string;
  hiuId: string;
  purpose: ConsentPurpose;
  hiTypes: HiType[];
  dateRange: DateRange;
  expiresAt: string;
}

export type ConsentState = "requested" | "pending_patient" | "granted" | "denied" | "expired" | "revoked" | "failed";

export interface ConsentTransaction {
  /** Our correlation ID, sent as the request ID to the gateway. */
  requestId: string;
  /** ID the gateway assigns once it accepts the request. */
  consentRequestId?: string;
  request: ConsentRequestInput;
  state: ConsentState;
  artefacts: ConsentArtefact[];
  /** Event IDs already applied, so replayed or duplicate callbacks change nothing. */
  appliedEventIds: string[];
  updatedAt: string;
  failure?: { code: string; message: string };
}

type EventBase = { eventId: string; at: string };

export type ConsentEvent = EventBase &
  (
    | { type: "acknowledged"; consentRequestId: string }
    | { type: "granted"; artefacts: ConsentArtefact[] }
    | { type: "denied" }
    | { type: "expired" }
    | { type: "revoked" }
    | { type: "failed"; code: string; message: string }
  );

export type ConsentEventType = ConsentEvent["type"];
