/** One callback as received from the ABDM gateway, stored before the 202 is returned. */
export interface StoredCallback {
  id: number;
  requestId: string;
  /** Callback path after `/abdm/`, such as `v3/hiu/consent/request/notify`. */
  path: string;
  receivedAt: string;
  /** Selected ABDM headers (request ID, timestamp, CM ID, HIP/HIU ID), not the gateway's token. */
  headers: Record<string, string>;
  body: string;
}

export type NewCallback = Omit<StoredCallback, "id">;

export interface CallbackStore {
  /**
   * Store a callback unless its request ID was seen within the retention period. Request IDs are
   * remembered after the callback itself is removed, so a replay is still refused.
   */
  insert(callback: NewCallback): Promise<"stored" | "duplicate">;
  /** Callbacks with an ID above `after`, oldest first. */
  list(after: number, limit: number): Promise<StoredCallback[]>;
  /** Delete callbacks the core has processed; returns how many were deleted. */
  remove(ids: number[]): Promise<number>;
}

/** How long request IDs are remembered: well beyond the timestamp window and any gateway token's lifetime. */
export const SEEN_RETENTION_MS = 24 * 60 * 60_000;

export class InMemoryCallbackStore implements CallbackStore {
  readonly #rows: StoredCallback[] = [];
  readonly #seen = new Map<string, number>();
  #nextId = 1;

  async insert(callback: NewCallback): Promise<"stored" | "duplicate"> {
    const now = Date.parse(callback.receivedAt);
    for (const [id, at] of this.#seen) if (now - at > SEEN_RETENTION_MS) this.#seen.delete(id);
    if (this.#seen.has(callback.requestId)) return "duplicate";
    this.#seen.set(callback.requestId, now);
    this.#rows.push({ id: this.#nextId++, ...callback });
    return "stored";
  }

  async list(after: number, limit: number): Promise<StoredCallback[]> {
    return this.#rows.filter((r) => r.id > after).slice(0, limit);
  }

  async remove(ids: number[]): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      const i = this.#rows.findIndex((r) => r.id === id);
      if (i >= 0) {
        this.#rows.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}

type D1Statement = { run(): Promise<{ meta: { changes: number } }>; all<T>(): Promise<{ results: T[] }> };

/** The parts of Cloudflare's D1 API this store uses. */
export interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): D1Statement };
  /** Runs the statements in one transaction. */
  batch(statements: D1Statement[]): Promise<{ meta: { changes: number } }[]>;
}

/** D1-backed store; see `schema.sql`. Request IDs are unique in the table, so duplicates are refused atomically. */
export class D1CallbackStore implements CallbackStore {
  constructor(private readonly db: D1Like) {}

  async insert(c: NewCallback): Promise<"stored" | "duplicate"> {
    const now = Date.parse(c.receivedAt);
    // One transaction: forget old request IDs, record this one, and store the callback only if the ID was new.
    const [, seen] = await this.db.batch([
      this.db.prepare("DELETE FROM seen_requests WHERE seen_at < ?").bind(now - SEEN_RETENTION_MS),
      this.db.prepare("INSERT OR IGNORE INTO seen_requests (request_id, seen_at) VALUES (?, ?)").bind(c.requestId, now),
      this.db
        .prepare("INSERT INTO callbacks (request_id, path, received_at, headers, body) SELECT ?, ?, ?, ?, ? WHERE changes() = 1")
        .bind(c.requestId, c.path, c.receivedAt, JSON.stringify(c.headers), c.body),
    ]);
    return seen?.meta.changes === 1 ? "stored" : "duplicate";
  }

  async list(after: number, limit: number): Promise<StoredCallback[]> {
    type Row = { id: number; request_id: string; path: string; received_at: string; headers: string; body: string };
    const { results } = await this.db
      .prepare("SELECT id, request_id, path, received_at, headers, body FROM callbacks WHERE id > ? ORDER BY id LIMIT ?")
      .bind(after, limit)
      .all<Row>();
    return results.map((r) => ({ id: r.id, requestId: r.request_id, path: r.path, receivedAt: r.received_at, headers: JSON.parse(r.headers) as Record<string, string>, body: r.body }));
  }

  async remove(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { meta } = await this.db.prepare(`DELETE FROM callbacks WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).run();
    return meta.changes;
  }
}
