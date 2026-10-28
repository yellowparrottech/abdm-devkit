import type { webcrypto } from "node:crypto";
import type { CallbackStore, NewCallback, StoredCallback } from "./store.js";

// Type-only import: Workers provide the same Web Crypto key type at runtime.
type CryptoKey = webcrypto.CryptoKey;

const PREFIX = "v1:";
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Imports a base64 32-byte key, such as the Worker secret STORAGE_KEY (`openssl rand -base64 32`). */
export async function importStorageKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key.trim());
  if (raw.length !== 32) throw new Error("STORAGE_KEY must be 32 random bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts each callback body before it reaches the database, and decrypts it when the core
 * collects it. Consent notifications can name a patient, so nothing readable is stored at rest.
 * The request ID is bound to the ciphertext, so a stored body cannot be moved to another row.
 */
export class EncryptedCallbackStore implements CallbackStore {
  constructor(
    private readonly inner: CallbackStore,
    private readonly key: CryptoKey,
  ) {}

  async insert(callback: NewCallback): Promise<"stored" | "duplicate"> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(callback.requestId) },
        this.key,
        new TextEncoder().encode(callback.body),
      ),
    );
    const stored = new Uint8Array(iv.length + sealed.length);
    stored.set(iv);
    stored.set(sealed, iv.length);
    return this.inner.insert({ ...callback, body: PREFIX + toBase64(stored) });
  }

  async list(after: number, limit: number): Promise<StoredCallback[]> {
    const rows = await this.inner.list(after, limit);
    return Promise.all(rows.map(async (row) => ({ ...row, body: await this.#open(row) })));
  }

  remove(ids: number[]): Promise<number> {
    return this.inner.remove(ids);
  }

  async #open(row: StoredCallback): Promise<string> {
    if (!row.body.startsWith(PREFIX)) throw new Error(`Callback ${row.id} is not encrypted`);
    const bytes = fromBase64(row.body.slice(PREFIX.length));
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(row.requestId) },
      this.key,
      bytes.slice(12),
    );
    return new TextDecoder().decode(opened);
  }
}
