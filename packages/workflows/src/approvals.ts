import { err, ok, type Clock, type Result } from "@yellowparrottech/abdm-core";

export type ApprovalError = { code: "approval_not_found" } | { code: "approval_expired" } | { code: "approval_already_used" };

interface Entry<T> {
  actorId: string;
  payload: T;
  expiresAt: number;
  used: boolean;
}

/** Approvals bound to one actor and one exact payload; each works once and expires. */
export class ApprovalBook<T> {
  readonly #entries = new Map<string, Entry<T>>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number,
    private readonly newId: () => string,
  ) {}

  issue(actorId: string, payload: T): { approvalId: string; expiresAt: string } {
    this.#prune();
    const approvalId = this.newId();
    const expiresAt = this.clock.now().getTime() + this.ttlMs;
    // A copy, so a caller changing its object afterwards cannot change what was approved.
    this.#entries.set(approvalId, { actorId, payload: structuredClone(payload), expiresAt, used: false });
    return { approvalId, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Use an approval. With `expected`, it must be for exactly that payload (key order ignored). */
  redeem(actorId: string, approvalId: string, expected?: T): Result<T, ApprovalError> {
    const entry = this.#entries.get(approvalId);
    if (!entry || entry.actorId !== actorId) return err({ code: "approval_not_found" });
    if (expected !== undefined && canonical(expected) !== canonical(entry.payload)) return err({ code: "approval_not_found" });
    if (entry.used) return err({ code: "approval_already_used" });
    if (this.clock.now().getTime() >= entry.expiresAt) return err({ code: "approval_expired" });
    entry.used = true;
    return ok(structuredClone(entry.payload));
  }

  /** Forget approvals that can no longer be used. */
  #prune(): void {
    const now = this.clock.now().getTime();
    for (const [id, entry] of this.#entries) if (entry.used || now >= entry.expiresAt) this.#entries.delete(id);
  }
}

/** JSON with object keys sorted, so equal payloads compare equal whatever order they were built in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}
