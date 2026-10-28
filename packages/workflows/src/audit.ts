import type { HiType } from "@yellowparrottech/abdm-core";

/** One audit record. It names what happened, never record contents or patient details. */
export interface AuditEntry {
  at: string;
  actorId?: string;
  action:
    | "consent_approval_issued"
    | "consent_request_submitted"
    | "consent_callback"
    | "consent_status_read"
    | "health_info_authorised"
    | "health_info_requested"
    | "health_info_received"
    | "health_info_read"
    | "health_info_discarded";
  outcome: "ok" | "denied" | "rejected";
  requestId?: string;
  consentRequestId?: string;
  hiTypes?: HiType[];
  reason?: string;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
}

export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}
