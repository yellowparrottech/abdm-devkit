import { createBridgeApp } from "./app.js";
import { EncryptedCallbackStore, importStorageKey } from "./encrypted-store.js";
import { D1CallbackStore, type D1Like } from "./store.js";
import { createJwksVerifier } from "./verify.js";

export interface Env {
  DB: D1Like;
  /** Secret: `wrangler secret put INBOX_TOKEN`. */
  INBOX_TOKEN: string;
  /** Secret: 32 random bytes, base64 (`openssl rand -base64 32 | wrangler secret put STORAGE_KEY`). Encrypts stored callbacks. */
  STORAGE_KEY: string;
  /** The ABDM gateway's key set URL for the environment (sandbox or production). */
  ABDM_JWKS_URL: string;
  /** The `iss` claim ABDM's gateway tokens carry. */
  ABDM_ISSUER: string;
  /** The `aud` claim, if ABDM sets one for your client. */
  ABDM_AUDIENCE?: string;
}

let app: ReturnType<typeof createBridgeApp> | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Refuse to run half-configured: unverifiable callbacks, an open inbox or readable storage are all worse than no bridge.
    if (!env.ABDM_JWKS_URL || !env.ABDM_ISSUER || !env.INBOX_TOKEN || !env.STORAGE_KEY) return new Response("Bridge is not configured", { status: 503 });
    app ??= createBridgeApp({
      store: new EncryptedCallbackStore(new D1CallbackStore(env.DB), await importStorageKey(env.STORAGE_KEY)),
      inboxToken: env.INBOX_TOKEN,
      verify: createJwksVerifier({ jwksUrl: env.ABDM_JWKS_URL, issuer: env.ABDM_ISSUER, ...(env.ABDM_AUDIENCE ? { audience: env.ABDM_AUDIENCE } : {}) }),
    });
    return app.fetch(request);
  },
};
