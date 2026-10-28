import { Hono } from "hono";
import type { CallbackStore } from "./store.js";
import type { CallbackVerifier } from "./verify.js";

export interface BridgeOptions {
  store: CallbackStore;
  verify: CallbackVerifier;
  /** Secret the core uses to read the inbox. */
  inboxToken: string;
  now?: () => number;
  /**
   * Largest callback body accepted. D1 stores at most about 2 MB per row, so the default stays under
   * that; ABDM splits larger record pushes into pages.
   */
  maxBodyBytes?: number;
  /** How far a callback's TIMESTAMP header may be from the bridge's clock. */
  maxSkewMs?: number;
}

/** ABDM headers worth keeping with a callback. The gateway's bearer token is deliberately not stored. */
const KEPT_HEADERS = ["request-id", "timestamp", "x-cm-id", "x-hip-id", "x-hiu-id", "content-type"];

/**
 * Receives ABDM gateway callbacks and keeps them until the core collects them.
 *
 * - `POST /abdm/<callback path>`: verify the gateway's token, refuse replays (request ID seen before
 *   or timestamp outside the window), store durably, then return 202 as ABDM expects.
 * - `GET /v1/inbox?after=<id>` and `POST /v1/inbox/ack`: the core pulls and acknowledges callbacks with
 *   the inbox token, so it can run anywhere, including behind NAT.
 */
export function createBridgeApp(options: BridgeOptions): Hono {
  const now = options.now ?? Date.now;
  const maxBodyBytes = options.maxBodyBytes ?? 1_900_000;
  const maxSkewMs = options.maxSkewMs ?? 5 * 60_000;
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/abdm/*", async (c) => {
    const declared = c.req.header("content-length");
    if (declared !== undefined && !/^\d+$/.test(declared)) return c.json({ error: "invalid content-length" }, 400);
    if (Number(declared ?? 0) > maxBodyBytes) return c.json({ error: "body too large" }, 413);
    if (!(await options.verify(c.req.raw))) return c.json({ error: "unauthenticated" }, 401);

    const requestId = c.req.header("request-id");
    if (!requestId || !/^[\w:.-]{1,128}$/.test(requestId)) return c.json({ error: "missing or malformed REQUEST-ID" }, 400);
    // ISO 8601 with an explicit zone, so the time cannot be read in the server's local zone.
    const rawTimestamp = c.req.header("timestamp") ?? "";
    const timestamp = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(rawTimestamp) ? Date.parse(rawTimestamp) : Number.NaN;
    if (Number.isNaN(timestamp) || Math.abs(now() - timestamp) > maxSkewMs) return c.json({ error: "missing or stale TIMESTAMP" }, 400);

    // Read at most maxBodyBytes, whatever content-length claimed.
    const body = await readLimited(c.req.raw, maxBodyBytes);
    if (body === undefined) return c.json({ error: "body too large" }, 413);

    const headers = Object.fromEntries(KEPT_HEADERS.flatMap((h) => (c.req.header(h) ? [[h, c.req.header(h)!]] : [])));
    const outcome = await options.store.insert({ requestId, path: c.req.path.slice("/abdm/".length), receivedAt: new Date(now()).toISOString(), headers, body });
    // A replayed request ID is acknowledged but not stored again, so a retrying gateway is not punished.
    return c.json({ status: outcome === "stored" ? "accepted" : "duplicate" }, 202);
  });

  const inbox = new Hono();
  inbox.use(async (c, next) => {
    const given = new TextEncoder().encode(c.req.header("authorization") ?? "");
    const expected = new TextEncoder().encode(`Bearer ${options.inboxToken}`);
    if (!options.inboxToken || !equalBytes(given, expected)) return c.json({ error: "unauthenticated" }, 401);
    await next();
  });
  inbox.get("/", async (c) => {
    const after = Number(c.req.query("after") ?? 0);
    const limit = Math.min(Number(c.req.query("limit") ?? 50), MAX_PAGE);
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1) return c.json({ error: "invalid after or limit" }, 400);
    const callbacks = await options.store.list(after, limit);
    return c.json({ callbacks, next: callbacks.at(-1)?.id ?? after });
  });
  inbox.post("/ack", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { ids?: unknown } | undefined;
    const ids = Array.isArray(body?.ids) && body.ids.every((id) => Number.isSafeInteger(id) && (id as number) > 0) ? (body.ids as number[]) : undefined;
    // D1 binds at most 100 parameters per query.
    if (!ids || ids.length > MAX_PAGE) return c.json({ error: `ids must be up to ${MAX_PAGE} positive integers` }, 400);
    return c.json({ removed: await options.store.remove(ids) });
  });
  app.route("/v1/inbox", inbox);

  return app;
}

/** Largest inbox page and acknowledgement, matching D1's limit on bound parameters. */
export const MAX_PAGE = 100;

async function readLimited(request: Request, max: number): Promise<string | undefined> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Constant-time comparison for equal-length inputs. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
