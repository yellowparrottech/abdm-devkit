import { describe, expect, it } from "vitest";
import { createBridgeApp, EncryptedCallbackStore, importStorageKey, InMemoryCallbackStore } from "./index.js";

const NOW = Date.parse("2026-01-10T09:00:00.000Z");
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const body = JSON.stringify({ status: "GRANTED", patient: { id: "asha.rao1@sbx" } });
const callback = { requestId: "req-1", path: "v3/hiu/consent/request/notify", receivedAt: new Date(NOW).toISOString(), headers: {}, body };

describe("encrypted callback storage", () => {
  it("stores nothing readable and returns the original body to the inbox", async () => {
    const raw = new InMemoryCallbackStore();
    const store = new EncryptedCallbackStore(raw, await importStorageKey(KEY));
    await store.insert(callback);
    const [stored] = await raw.list(0, 10);
    expect(stored!.body.startsWith("v1:")).toBe(true);
    expect(stored!.body).not.toContain("asha.rao1");
    expect((await store.list(0, 10))[0]!.body).toBe(body);
  });

  it("cannot be read with another key", async () => {
    const raw = new InMemoryCallbackStore();
    await new EncryptedCallbackStore(raw, await importStorageKey(KEY)).insert(callback);
    const otherKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await expect(new EncryptedCallbackStore(raw, await importStorageKey(otherKey)).list(0, 10)).rejects.toThrow();
  });

  it("refuses a body moved to another row", async () => {
    const raw = new InMemoryCallbackStore();
    const store = new EncryptedCallbackStore(raw, await importStorageKey(KEY));
    await store.insert(callback);
    const [stored] = await raw.list(0, 10);
    const swapped = new InMemoryCallbackStore();
    await swapped.insert({ ...callback, requestId: "req-2", body: stored!.body });
    await expect(new EncryptedCallbackStore(swapped, await importStorageKey(KEY)).list(0, 10)).rejects.toThrow();
  });

  it("rejects keys of the wrong length", async () => {
    await expect(importStorageKey(btoa("too short"))).rejects.toThrow("32 random bytes");
  });

  it("works end to end behind the bridge", async () => {
    const raw = new InMemoryCallbackStore();
    const app = createBridgeApp({ store: new EncryptedCallbackStore(raw, await importStorageKey(KEY)), verify: async () => true, inboxToken: "t", now: () => NOW });
    await app.request("/abdm/v3/hiu/consent/request/notify", { method: "POST", headers: { "request-id": "req-1", timestamp: new Date(NOW).toISOString() }, body });
    const inbox = (await (await app.request("/v1/inbox", { headers: { authorization: "Bearer t" } })).json()) as { callbacks: { body: string }[] };
    expect(inbox.callbacks[0]!.body).toBe(body);
    expect(JSON.stringify(await raw.list(0, 10))).not.toContain("asha.rao1");
  });
});
