import type { webcrypto } from "node:crypto";

/** Decides whether a request really came from the ABDM gateway. */
export type CallbackVerifier = (request: Request) => Promise<boolean>;

export interface JwksVerifierOptions {
  /** URL of the gateway's JSON Web Key Set. Confirm the V3 location in the sandbox before use. */
  jwksUrl: string;
  /** Expected `iss` claim. Required by the Worker; confirm ABDM's value in the sandbox. */
  issuer?: string;
  /** Expected `aud` claim, when ABDM sets one for your client. */
  audience?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long fetched keys are reused before fetching again. */
  cacheMs?: number;
  /** Least time between fetches forced by an unknown key ID, so forged tokens cannot trigger a fetch each. */
  minRefreshMs?: number;
}

// Type-only import: Workers provide the same Web Crypto JsonWebKey shape at runtime.
type Jwk = webcrypto.JsonWebKey & { kid?: string };

const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const LEEWAY_SECONDS = 60;

/**
 * Verifies the gateway's bearer token on each callback: an RS256 JWT signed by a key from the
 * gateway's published key set, currently valid, and (optionally) from the expected issuer.
 */
export function createJwksVerifier(options: JwksVerifierOptions): CallbackVerifier {
  const fetchKeys = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? 10 * 60_000;
  const minRefreshMs = options.minRefreshMs ?? 60_000;
  let cached: { keys: Jwk[]; at: number } | undefined;
  let lastAttempt = Number.NEGATIVE_INFINITY;

  /** Current keys. A failed fetch keeps the previous keys rather than rejecting every callback. */
  const keySet = async (refresh: boolean): Promise<Jwk[]> => {
    const fresh = cached && now() - cached.at < cacheMs;
    if (fresh && !refresh) return cached!.keys;
    if (cached && now() - lastAttempt < minRefreshMs) return cached.keys;
    lastAttempt = now();
    try {
      const response = await fetchKeys(options.jwksUrl);
      if (!response.ok) throw new Error(`Key set fetch failed with ${response.status}`);
      const body = (await response.json()) as { keys?: Jwk[] };
      cached = { keys: body.keys ?? [], at: now() };
    } catch (error) {
      if (!cached) throw error;
    }
    return cached.keys;
  };

  return async (request) => {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    // Gateway tokens are small; refuse anything absurd before parsing.
    if (token && token.length > 8_192) return false;
    const parts = token?.split(".");
    if (!parts || parts.length !== 3) return false;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    try {
      const header = JSON.parse(new TextDecoder().decode(decode(headerPart))) as { alg?: string; kid?: string };
      if (header.alg !== "RS256") return false;

      // An unknown key ID may mean the gateway rotated keys; refetch once.
      let jwk = (await keySet(false)).find((k) => k.kid === header.kid);
      jwk ??= (await keySet(true)).find((k) => k.kid === header.kid);
      if (!jwk) return false;

      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
      if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(signaturePart), signed))) return false;

      const claims = JSON.parse(new TextDecoder().decode(decode(payloadPart))) as { exp?: number; nbf?: number; iss?: string; aud?: string | string[] };
      const seconds = now() / 1000;
      if (typeof claims.exp !== "number" || claims.exp + LEEWAY_SECONDS < seconds) return false;
      if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_SECONDS > seconds) return false;
      if (options.issuer !== undefined && claims.iss !== options.issuer) return false;
      if (options.audience !== undefined && ![claims.aud].flat().includes(options.audience)) return false;
      return true;
    } catch {
      return false;
    }
  };
}
