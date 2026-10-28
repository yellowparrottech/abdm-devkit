import { bigintToBytes, fromBase64, toBase64, xor } from "./bytes.js";
import { curveDh } from "./curve.js";
import { decodeSpki, encodeSpki } from "./spki.js";

// ABDM's health-data encryption ("Fidelius"): ECDH on Curve25519 (Weierstrass form) gives a
// shared secret; the XOR of both parties' 32-byte nonces gives the HKDF-SHA256 salt (first 20
// bytes) and the AES-256-GCM IV (last 12 bytes). All values travel as base64.

const NONCE_BYTES = 32;

/** One party's keys and nonce, all base64. Keep `privateKey` secret and server-side. */
export interface KeyMaterial {
  privateKey: string;
  /** 65-byte uncompressed point. */
  publicKey: string;
  /** The same key as X.509 SubjectPublicKeyInfo, as sent in ABDM key material. */
  x509PublicKey: string;
  nonce: string;
}

export interface EncryptInput {
  plaintext: string | Uint8Array;
  senderPrivateKey: string;
  senderNonce: string;
  /** Raw 65-byte key or X.509, base64. */
  receiverPublicKey: string;
  receiverNonce: string;
}

export interface DecryptInput {
  encryptedData: string;
  receiverPrivateKey: string;
  receiverNonce: string;
  /** Raw 65-byte key or X.509, base64. */
  senderPublicKey: string;
  senderNonce: string;
}

export function generateKeyMaterial(): KeyMaterial {
  const secretKey = curveDh.utils.randomSecretKey();
  const publicKey = curveDh.getPublicKey(secretKey, false);
  return {
    privateKey: toBase64(secretKey),
    publicKey: toBase64(publicKey),
    x509PublicKey: toBase64(encodeSpki(publicKey)),
    nonce: toBase64(crypto.getRandomValues(new Uint8Array(NONCE_BYTES))),
  };
}

export async function encrypt(input: EncryptInput): Promise<string> {
  const { key, iv } = await deriveKey(input.senderPrivateKey, input.receiverPublicKey, input.senderNonce, input.receiverNonce, "encrypt");
  const plaintext = typeof input.plaintext === "string" ? new TextEncoder().encode(input.plaintext) : input.plaintext;
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, key, plaintext);
  return toBase64(new Uint8Array(sealed));
}

/** Returns the plaintext bytes. Throws if the data was tampered with or the keys do not match. */
export async function decrypt(input: DecryptInput): Promise<Uint8Array> {
  const { key, iv } = await deriveKey(input.receiverPrivateKey, input.senderPublicKey, input.receiverNonce, input.senderNonce, "decrypt");
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, key, fromBase64(input.encryptedData));
  return new Uint8Array(opened);
}

export async function decryptToString(input: DecryptInput): Promise<string> {
  return new TextDecoder().decode(await decrypt(input));
}

/** The 32-byte ECDH shared secret (x-coordinate of the shared point), base64. Exposed for interop tests. */
export function sharedSecret(privateKey: string, peerPublicKey: string): string {
  return toBase64(computeSharedSecret(privateKey, peerPublicKey));
}

function computeSharedSecret(privateKey: string, peerPublicKey: string): Uint8Array {
  const point = curveDh.getSharedSecret(normalisePrivateKey(fromBase64(privateKey)), rawPublicKey(fromBase64(peerPublicKey)), true);
  return point.slice(1); // drop the compressed-point prefix byte, leaving x
}

async function deriveKey(privateKey: string, peerPublicKey: string, ownNonce: string, peerNonce: string, usage: "encrypt" | "decrypt") {
  const nonce = xor(fromBase64(ownNonce), fromBase64(peerNonce));
  if (nonce.length !== NONCE_BYTES) throw new RangeError(`Nonces must be ${NONCE_BYTES} bytes`);
  const salt = nonce.slice(0, 20);
  const iv = nonce.slice(nonce.length - 12);

  const ikm = await crypto.subtle.importKey("raw", computeSharedSecret(privateKey, peerPublicKey), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt, info: new Uint8Array(0) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
  return { key, iv };
}

/** Java's BigInteger encoding can add a leading zero or drop leading zeros; normalise to 32 bytes. */
function normalisePrivateKey(bytes: Uint8Array): Uint8Array {
  const value = bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
  return bigintToBytes(value, 32);
}

function rawPublicKey(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 65 && bytes[0] === 0x04) return bytes;
  return decodeSpki(bytes);
}
