export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new RangeError("Nonces must be the same length");
  return a.map((x, i) => x ^ b[i]!);
}

/** Big-endian bytes of `n`, left-padded to `length`. */
export function bigintToBytes(n: bigint, length: number): Uint8Array {
  const hex = n.toString(16).padStart(length * 2, "0");
  if (hex.length > length * 2) throw new RangeError("Number does not fit");
  return Uint8Array.from({ length }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}
