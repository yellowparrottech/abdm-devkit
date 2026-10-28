import type { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBridgeApp, createJwksVerifier, InMemoryCallbackStore } from "./index.js";

const NOW = Date.parse("2026-01-10T09:00:00.000Z");
const INBOX_TOKEN = "inbox-secret";

function setup(verified = true) {
  const store = new InMemoryCallbackStore();
  const app = createBridgeApp({ store, verify: async () => verified, inboxToken: INBOX_TOKEN, now: () => NOW, maxBodyBytes: 1_000 });
  const callback = (requestId: string, body = '{"status":"GRANTED"}', timestamp = new Date(NOW).toISOString()) =>
    app.request("/abdm/v3/hiu/consent/request/notify", {
      method: "POST",
      headers: { "content-type": "application/json", "request-id": requestId, timestamp, "x-cm-id": "sbx", authorization: "Bearer gateway-token" },
      body,
    });
  const inbox = (path = "", init: RequestInit = {}, token = INBOX_TOKEN) =>
    app.request(`/v1/inbox${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
  return { store, callback, inbox };
}

describe("callback bridge", () => {
  it("stores a verified callback and returns 202", async () => {
    const { callback, inbox } = setup();
    const res = await callback("req-1");
    expect(res.status).toBe(202);
    const { callbacks } = (await (await inbox()).json()) as { callbacks: { path: string; headers: Record<string, string>; body: string }[] };
    expect(callbacks).toMatchObject([{ path: "v3/hiu/consent/request/notify", body: '{"status":"GRANTED"}', headers: { "request-id": "req-1", "x-cm-id": "sbx" } }]);
    expect(callbacks[0]!.headers).not.toHaveProperty("authorization");
  });

  it("refuses callbacks that fail gateway verification", async () => {
    const { callback, inbox } = setup(false);
    expect((await callback("req-1")).status).toBe(401);
    expect(((await (await inbox()).json()) as { callbacks: unknown[] }).callbacks).toEqual([]);
  });

  it("stores a replayed request ID only once", async () => {
    const { callback, inbox } = setup();
    await callback("req-1");
    const replay = await callback("req-1", '{"status":"DENIED"}');
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({ status: "duplicate" });
    const { callbacks } = (await (await inbox()).json()) as { callbacks: { body: string }[] };
    expect(callbacks.map((c) => c.body)).toEqual(['{"status":"GRANTED"}']);
  });

  it.each([
    ["a stale timestamp", "req-1", new Date(NOW - 10 * 60_000).toISOString(), 400],
    ["a malformed request ID", "req 1; drop", new Date(NOW).toISOString(), 400],
  ])("refuses %s", async (_, requestId, timestamp, status) => {
    const { callback } = setup();
    expect((await callback(requestId, "{}", timestamp)).status).toBe(status);
  });

  it("refuses bodies over the size limit", async () => {
    const { callback } = setup();
    expect((await callback("req-1", "x".repeat(2_000))).status).toBe(413);
  });

  it("lets the core page through and acknowledge callbacks", async () => {
    const { callback, inbox } = setup();
    for (const id of ["a", "b", "c"]) await callback(id);
    const page = (await (await inbox("?after=0&limit=2")).json()) as { callbacks: { id: number }[]; next: number };
    expect(page.callbacks.map((c) => c.id)).toEqual([1, 2]);
    await inbox("/ack", { method: "POST", body: JSON.stringify({ ids: [1, 2] }) });
    const rest = (await (await inbox(`?after=0`)).json()) as { callbacks: { id: number }[] };
    expect(rest.callbacks.map((c) => c.id)).toEqual([3]);
  });

  it("still refuses a replayed request ID after the original was acknowledged", async () => {
    const { callback, inbox } = setup();
    await callback("req-1");
    await inbox("/ack", { method: "POST", body: JSON.stringify({ ids: [1] }) });
    const replay = await callback("req-1", '{"status":"DENIED"}');
    expect(await replay.json()).toEqual({ status: "duplicate" });
    expect(((await (await inbox()).json()) as { callbacks: unknown[] }).callbacks).toEqual([]);
  });

  it.each([
    ["a non-numeric content-length", { "content-length": "abc" }, 400],
    ["a timestamp without a time zone", { timestamp: "2026-01-10T09:00:00" }, 400],
  ])("refuses %s", async (_, headers, status) => {
    const { store } = setup();
    const app = createBridgeApp({ store, verify: async () => true, inboxToken: INBOX_TOKEN, now: () => NOW });
    const res = await app.request("/abdm/x", {
      method: "POST",
      headers: { "request-id": "req-1", timestamp: new Date(NOW).toISOString(), ...headers },
      body: "{}",
    });
    expect(res.status).toBe(status);
  });

  it("stops reading a body that is larger than its content-length claimed", async () => {
    const { store } = setup();
    const app = createBridgeApp({ store, verify: async () => true, inboxToken: INBOX_TOKEN, now: () => NOW, maxBodyBytes: 1_000 });
    const res = await app.request(
      new Request("https://bridge.example/abdm/x", {
        method: "POST",
        headers: { "request-id": "req-1", timestamp: new Date(NOW).toISOString(), "content-length": "10" },
        body: "x".repeat(5_000),
      }),
    );
    expect(res.status).toBe(413);
    expect(await store.list(0, 10)).toEqual([]);
  });

  it.each([
    ["more than 100 IDs", Array.from({ length: 101 }, (_, i) => i + 1)],
    ["a negative ID", [-1]],
    ["a huge ID", [1e300]],
  ])("refuses an acknowledgement with %s", async (_, ids) => {
    const { inbox } = setup();
    expect((await inbox("/ack", { method: "POST", body: JSON.stringify({ ids }) })).status).toBe(400);
  });

  it("reports how many callbacks an acknowledgement actually removed", async () => {
    const { callback, inbox } = setup();
    await callback("req-1");
    const res = await inbox("/ack", { method: "POST", body: JSON.stringify({ ids: [1, 99] }) });
    expect(await res.json()).toEqual({ removed: 1 });
  });

  it("requires the inbox token", async () => {
    const { inbox } = setup();
    expect((await inbox("", {}, "wrong")).status).toBe(401);
  });
});

describe("gateway token verification", () => {
  const b64url = (bytes: Uint8Array | string) =>
    btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function gateway() {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as webcrypto.CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "gw-1" };
    const sign = async (claims: object, header: object = { alg: "RS256", kid: "gw-1" }) => {
      const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
      const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned)));
      return `${unsigned}.${b64url(signature)}`;
    };
    let fetches = 0;
    let clock = NOW;
    let gatewayDown = false;
    const verify = createJwksVerifier({
      jwksUrl: "https://gateway.example/certs",
      issuer: "gateway",
      audience: "bridge-client",
      now: () => clock,
      fetch: (async () => {
        fetches++;
        return gatewayDown ? new Response("down", { status: 503 }) : new Response(JSON.stringify({ keys: [jwk] }));
      }) as typeof fetch,
    });
    const check = (token: string) => verify(new Request("https://bridge.example/abdm/x", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    return {
      sign,
      check,
      fetches: () => fetches,
      advance: (ms: number) => (clock += ms),
      setGatewayDown: (down: boolean) => (gatewayDown = down),
    };
  }

  const valid = { iss: "gateway", aud: "bridge-client", exp: NOW / 1000 + 300 };

  it("accepts a current token signed by the gateway's key", async () => {
    const g = await gateway();
    expect(await g.check(await g.sign(valid))).toBe(true);
    expect(await g.check(await g.sign(valid))).toBe(true);
    expect(g.fetches()).toBe(1);
  });

  it.each([
    ["an expired token", { ...valid, exp: NOW / 1000 - 600 }, undefined],
    ["a token from another issuer", { ...valid, iss: "someone-else" }, undefined],
    ["a token without an expiry", { iss: "gateway" }, undefined],
    ["an unsigned token", valid, { alg: "none", kid: "gw-1" }],
    ["an unknown key ID", valid, { alg: "RS256", kid: "other" }],
  ])("rejects %s", async (_, claims, header) => {
    const g = await gateway();
    expect(await g.check(await g.sign(claims, header))).toBe(false);
  });

  it("rejects a token for another audience", async () => {
    const g = await gateway();
    expect(await g.check(await g.sign({ ...valid, aud: "someone-else" }))).toBe(false);
  });

  it("does not refetch the key set for every unknown key ID", async () => {
    const g = await gateway();
    await g.check(await g.sign(valid));
    for (let i = 0; i < 10; i++) await g.check(await g.sign(valid, { alg: "RS256", kid: `forged-${i}` }));
    expect(g.fetches()).toBeLessThanOrEqual(2);
  });

  it("keeps accepting real tokens on the cached keys while the key set cannot be fetched", async () => {
    const g = await gateway();
    expect(await g.check(await g.sign(valid))).toBe(true);
    g.setGatewayDown(true);
    g.advance(15 * 60_000);
    expect(await g.check(await g.sign({ ...valid, exp: (NOW + 20 * 60_000) / 1000 }))).toBe(true);
  });

  it("rejects a token whose payload was altered after signing", async () => {
    const g = await gateway();
    const [h, , s] = (await g.sign(valid)).split(".");
    expect(await g.check(`${h}.${b64url(JSON.stringify({ ...valid, iss: "gateway", sub: "admin" }))}.${s}`)).toBe(false);
  });

  it("rejects requests without a bearer token", async () => {
    const g = await gateway();
    expect(await g.check("not-a-jwt")).toBe(false);
  });
});
