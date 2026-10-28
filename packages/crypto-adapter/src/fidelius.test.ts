import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Point } from "./curve.js";
import { fromBase64, toBase64 } from "./bytes.js";
import { CURVE25519_WEIERSTRASS as C, decodeSpki, decrypt, decryptToString, encodeSpki, encrypt, generateKeyMaterial, sharedSecret } from "./index.js";

interface Party {
  privateKey: string;
  publicKey: string;
  nonce: string;
}
interface Vector {
  name: string;
  sender: Party;
  receiver: Party;
  plaintext: string;
  encryptedData: string;
  intermediates: { sharedSecret?: string };
  senderX509PublicKey?: string;
  receiverX509PublicKey?: string;
}

const { vectors } = JSON.parse(readFileSync(new URL("../test-vectors/abdm-fidelius-vectors.json", import.meta.url), "utf8")) as { vectors: Vector[] };

const mod = (x: bigint) => ((x % C.p) + C.p) % C.p;
const pow = (b: bigint, e: bigint): bigint => {
  let r = 1n;
  for (b = mod(b); e > 0n; e >>= 1n, b = mod(b * b)) if (e & 1n) r = mod(r * b);
  return r;
};

describe("Curve25519 in Weierstrass form", () => {
  it("has its generator on the curve", () => {
    expect(mod(C.Gy * C.Gy)).toBe(mod(C.Gx ** 3n + C.a * C.Gx + C.b));
  });

  it("maps to the X25519 base point u = 9 (x = u + A/3)", () => {
    expect(C.Gx).toBe(mod(9n + 486662n * pow(3n, C.p - 2n)));
  });

  it("has a generator of order n", () => {
    expect(Point.BASE.multiply(C.n - 1n).add(Point.BASE).is0()).toBe(true);
  });
});

describe("fidelius-cli 1.2.0 vectors", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s: reproduces the ciphertext exactly", async (_, v) => {
    const encryptedData = await encrypt({
      plaintext: v.plaintext,
      senderPrivateKey: v.sender.privateKey,
      senderNonce: v.sender.nonce,
      receiverPublicKey: v.receiverX509PublicKey ?? v.receiver.publicKey,
      receiverNonce: v.receiver.nonce,
    });
    expect(encryptedData).toBe(v.encryptedData);
  });

  it.each(vectors.map((v) => [v.name, v] as const))("%s: decrypts to the plaintext", async (_, v) => {
    const plaintext = await decryptToString({
      encryptedData: v.encryptedData,
      receiverPrivateKey: v.receiver.privateKey,
      receiverNonce: v.receiver.nonce,
      senderPublicKey: v.senderX509PublicKey ?? v.sender.publicKey,
      senderNonce: v.sender.nonce,
    });
    expect(plaintext).toBe(v.plaintext);
  });

  it("matches the published shared secret from both sides", () => {
    const v = vectors.find((x) => x.intermediates.sharedSecret)!;
    expect(sharedSecret(v.sender.privateKey, v.receiver.publicKey)).toBe(v.intermediates.sharedSecret);
    expect(sharedSecret(v.receiver.privateKey, v.sender.publicKey)).toBe(v.intermediates.sharedSecret);
  });

  it("encodes X.509 public keys byte for byte like fidelius-cli", () => {
    const v = vectors.find((x) => x.senderX509PublicKey)!;
    expect(toBase64(encodeSpki(fromBase64(v.sender.publicKey)))).toBe(v.senderX509PublicKey);
    expect(toBase64(decodeSpki(fromBase64(v.receiverX509PublicKey!)))).toBe(v.receiver.publicKey);
  });
});

describe("fidelius round trip", () => {
  const hiu = generateKeyMaterial();
  const hip = generateKeyMaterial();
  const bundle = JSON.stringify({ resourceType: "Bundle", type: "document", synthetic: true });

  const send = () =>
    encrypt({ plaintext: bundle, senderPrivateKey: hip.privateKey, senderNonce: hip.nonce, receiverPublicKey: hiu.x509PublicKey, receiverNonce: hiu.nonce });
  const receive = (encryptedData: string, overrides: Partial<Parameters<typeof decrypt>[0]> = {}) =>
    decryptToString({ encryptedData, receiverPrivateKey: hiu.privateKey, receiverNonce: hiu.nonce, senderPublicKey: hip.publicKey, senderNonce: hip.nonce, ...overrides });

  it("generates keys in the formats ABDM uses", () => {
    expect(fromBase64(hiu.privateKey)).toHaveLength(32);
    expect(fromBase64(hiu.publicKey)).toHaveLength(65);
    expect(fromBase64(hiu.nonce)).toHaveLength(32);
    expect(toBase64(decodeSpki(fromBase64(hiu.x509PublicKey)))).toBe(hiu.publicKey);
  });

  it("decrypts what it encrypts", async () => {
    expect(await receive(await send())).toBe(bundle);
  });

  it("rejects tampered ciphertext", async () => {
    const sealed = fromBase64(await send());
    sealed[0]! ^= 1;
    await expect(receive(toBase64(sealed))).rejects.toThrow();
  });

  it("rejects the wrong nonce or the wrong key", async () => {
    const sealed = await send();
    await expect(receive(sealed, { senderNonce: generateKeyMaterial().nonce })).rejects.toThrow();
    await expect(receive(sealed, { receiverPrivateKey: generateKeyMaterial().privateKey })).rejects.toThrow();
  });
});
