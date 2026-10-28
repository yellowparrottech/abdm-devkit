import { ecdh, weierstrass } from "@noble/curves/abstract/weierstrass.js";

/**
 * Curve25519 in short Weierstrass form (y² = x³ + ax + b), the form ABDM's reference Java
 * implementation uses through BouncyCastle. These are the curve's published parameters; the
 * group is the same as X25519's, but points and keys are encoded differently.
 */
export const CURVE25519_WEIERSTRASS: Readonly<Record<"p" | "a" | "b" | "Gx" | "Gy" | "n" | "h", bigint>> = {
  p: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn,
  a: 0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa984914a144n,
  b: 0x7b425ed097b425ed097b425ed097b425ed097b425ed097b4260b5e9c7710c864n,
  Gx: 0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad245an,
  Gy: 0x20ae19a1b8a086b4e01edd2c7748d14c923d4d7e6d7c61b229e9c5a27eced3d9n,
  n: 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn,
  h: 8n,
};

export const Point = weierstrass(CURVE25519_WEIERSTRASS);
export const curveDh = ecdh(Point);
