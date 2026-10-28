import { bigintToBytes, concat } from "./bytes.js";
import { CURVE25519_WEIERSTRASS as C } from "./curve.js";

// DER for an X.509 SubjectPublicKeyInfo carrying explicit Curve25519 Weierstrass parameters,
// the form ABDM's key material uses. Only the shapes needed here are encoded.
const tlv = (tag: number, body: Uint8Array): Uint8Array => concat(Uint8Array.of(tag), derLength(body.length), body);
const seq = (...items: Uint8Array[]) => tlv(0x30, concat(...items));
const int = (n: bigint) => {
  const bytes = bigintToBytes(n, Math.max(1, Math.ceil(n.toString(16).length / 2)));
  return tlv(0x02, bytes[0]! & 0x80 ? concat(Uint8Array.of(0), bytes) : bytes);
};
const oid = (...bytes: number[]) => tlv(0x06, Uint8Array.from(bytes));

const ID_EC_PUBLIC_KEY = oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01); // 1.2.840.10045.2.1
const PRIME_FIELD = oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x01, 0x01); // 1.2.840.10045.1.1

const ALGORITHM = seq(
  ID_EC_PUBLIC_KEY,
  seq(
    int(1n),
    seq(PRIME_FIELD, int(C.p)),
    seq(tlv(0x04, bigintToBytes(C.a, 32)), tlv(0x04, bigintToBytes(C.b, 32))),
    tlv(0x04, concat(Uint8Array.of(4), bigintToBytes(C.Gx, 32), bigintToBytes(C.Gy, 32))),
    int(C.n),
    int(C.h),
  ),
);

/** Wrap a 65-byte uncompressed public key in X.509 SubjectPublicKeyInfo. */
export function encodeSpki(rawPublicKey: Uint8Array): Uint8Array {
  return seq(ALGORITHM, tlv(0x03, concat(Uint8Array.of(0), rawPublicKey)));
}

/** Extract the 65-byte uncompressed public key from X.509 SubjectPublicKeyInfo. */
export function decodeSpki(der: Uint8Array): Uint8Array {
  const outer = readTlv(der, 0);
  if (outer.tag !== 0x30) throw new Error("Not an X.509 public key");
  const algorithm = readTlv(der, outer.start);
  const bitString = readTlv(der, algorithm.end);
  if (bitString.tag !== 0x03 || der[bitString.start] !== 0) throw new Error("Malformed public key bit string");
  return der.slice(bitString.start + 1, bitString.end);
}

function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes = bigintToBytes(BigInt(n), n < 0x100 ? 1 : 2);
  return concat(Uint8Array.of(0x80 | bytes.length), bytes);
}

function readTlv(der: Uint8Array, offset: number): { tag: number; start: number; end: number } {
  const tag = der[offset];
  let length = der[offset + 1];
  if (tag === undefined || length === undefined) throw new Error("Truncated DER");
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | (der[start + i] ?? 0);
    start += count;
  }
  if (start + length > der.length) throw new Error("Truncated DER");
  return { tag, start, end: start + length };
}
