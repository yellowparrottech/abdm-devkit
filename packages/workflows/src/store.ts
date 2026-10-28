import type { ConsentTransaction } from "@yellowparrottech/abdm-consent-engine";

export interface StoredConsent {
  ownerActorId: string;
  tx: ConsentTransaction;
}

/** Where consent transactions live between callbacks. Durable stores (such as D1) implement the same interface. */
export interface ConsentStore {
  get(requestId: string): StoredConsent | undefined;
  put(record: StoredConsent): void;
  /** Every request owned by one actor, oldest first. */
  listByOwner(ownerActorId: string): StoredConsent[];
}

export class InMemoryConsentStore implements ConsentStore {
  readonly #records = new Map<string, StoredConsent>();

  get(requestId: string): StoredConsent | undefined {
    return this.#records.get(requestId);
  }

  put(record: StoredConsent): void {
    this.#records.set(record.tx.requestId, record);
  }

  listByOwner(ownerActorId: string): StoredConsent[] {
    return [...this.#records.values()].filter((r) => r.ownerActorId === ownerActorId);
  }
}
