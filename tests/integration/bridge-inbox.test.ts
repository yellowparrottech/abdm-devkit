import { describe, expect, it } from "vitest";
import { createBridgeApp, InMemoryCallbackStore } from "@yellowparrottech/abdm-callback-bridge";
import { BridgeInbox, type BridgedCallback, type TranslatedCallback } from "@yellowparrottech/abdm-client";

const NOW = Date.parse("2026-01-10T09:00:00.000Z");

// A stand-in translator for a made-up wire format; the real V2/V3 translators come after sandbox checks.
const translate = (cb: BridgedCallback): TranslatedCallback | undefined => {
  if (cb.path !== "test/consent/notify") return undefined;
  const body = JSON.parse(cb.body) as { requestId: string; status: "granted" | "denied" };
  return body.status === "denied"
    ? { kind: "consent", requestId: body.requestId, event: { type: "denied", eventId: cb.requestId, at: cb.receivedAt } }
    : { kind: "consent", requestId: body.requestId, event: { type: "granted", eventId: cb.requestId, at: cb.receivedAt, artefacts: [] } };
};

function setup() {
  const store = new InMemoryCallbackStore();
  const bridge = createBridgeApp({ store, verify: async () => true, inboxToken: "inbox-secret", now: () => NOW });
  const gateway = (requestId: string, path: string, body: object) =>
    bridge.request(`/abdm/${path}`, {
      method: "POST",
      headers: { "request-id": requestId, timestamp: new Date(NOW).toISOString(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const bridgeFetch = ((url: string, init?: RequestInit) => bridge.request(url, init)) as typeof fetch;
  const inbox = new BridgeInbox({ baseUrl: "https://bridge.example/", inboxToken: "inbox-secret", translate, pageSize: 2, fetch: bridgeFetch });
  return { store, gateway, inbox, bridgeFetch };
}

describe("collecting callbacks from the bridge", () => {
  it("delivers every callback in order across pages and empties the inbox", async () => {
    const { gateway, inbox, store } = setup();
    for (const [i, status] of (["granted", "denied", "granted"] as const).entries()) await gateway(`cb-${i}`, "test/consent/notify", { requestId: `req-${i}`, status });
    const seen: string[] = [];
    const result = await inbox.drain({ consent: ({ requestId, event }) => void seen.push(`${requestId}:${event.type}`), data: () => {} });
    expect(seen).toEqual(["req-0:granted", "req-1:denied", "req-2:granted"]);
    expect(result).toMatchObject({ delivered: 3, unrecognised: [], failed: [] });
    expect(await store.list(0, 10)).toEqual([]);
  });

  it("acknowledges and reports callbacks it cannot translate", async () => {
    const { gateway, inbox, store } = setup();
    await gateway("cb-x", "v3/something/new", { hello: "world" });
    const result = await inbox.drain({ consent: () => {}, data: () => {} });
    expect(result.unrecognised.map((u) => u.callback.path)).toEqual(["v3/something/new"]);
    expect(await store.list(0, 10)).toEqual([]);
  });

  it("keeps a callback in the bridge when its handler fails, and delivers it on the next drain", async () => {
    const { gateway, inbox, store } = setup();
    await gateway("cb-1", "test/consent/notify", { requestId: "req-1", status: "granted" });
    const failing = await inbox.drain({ consent: () => Promise.reject(new Error("database down")), data: () => {} });
    expect(failing.failed).toHaveLength(1);
    expect(await store.list(0, 10)).toHaveLength(1);
    const retried = await inbox.drain({ consent: () => {}, data: () => {} });
    expect(retried.delivered).toBe(1);
    expect(await store.list(0, 10)).toEqual([]);
  });

  it("reports a callback its translator cannot read, and still delivers the rest", async () => {
    const { gateway, store, bridgeFetch } = setup();
    await gateway("cb-ok-1", "test/consent/notify", { requestId: "req-1", status: "granted" });
    await gateway("cb-bad", "test/consent/notify", { notWhatWeExpect: true });
    await gateway("cb-ok-2", "test/consent/notify", { requestId: "req-2", status: "denied" });
    const strict = (cb: BridgedCallback) => {
      if (!(JSON.parse(cb.body) as { requestId?: string }).requestId) throw new Error("unreadable callback");
      return translate(cb);
    };
    const inbox = new BridgeInbox({ baseUrl: "https://bridge.example", inboxToken: "inbox-secret", translate: strict, fetch: bridgeFetch });
    const seen: string[] = [];
    const result = await inbox.drain({ consent: ({ requestId }) => void seen.push(requestId), data: () => {} });
    expect(seen).toEqual(["req-1", "req-2"]);
    expect(result.unrecognised.map((u) => u.callback.requestId)).toEqual(["cb-bad"]);
    expect(await store.list(0, 10)).toEqual([]);
  });

  it("stops with a clear error when the inbox token is wrong", async () => {
    const bridge = createBridgeApp({ store: new InMemoryCallbackStore(), verify: async () => true, inboxToken: "inbox-secret" });
    const wrong = new BridgeInbox({
      baseUrl: "https://bridge.example",
      inboxToken: "nope",
      translate,
      fetch: ((url: string, init?: RequestInit) => bridge.request(url, init)) as typeof fetch,
    });
    await expect(wrong.drain({ consent: () => {}, data: () => {} })).rejects.toThrow("Callback bridge returned 401 for /v1/inbox");
  });
});
