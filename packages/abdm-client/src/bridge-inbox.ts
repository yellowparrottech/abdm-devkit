import type { DataPush } from "@yellowparrottech/abdm-core";
import type { ConsentEvent } from "@yellowparrottech/abdm-consent-engine";

/** A callback as stored by the callback bridge. */
export interface BridgedCallback {
  id: number;
  requestId: string;
  /** Callback path, such as `v3/hiu/consent/request/notify`. */
  path: string;
  receivedAt: string;
  headers: Record<string, string>;
  body: string;
}

/** What a raw ABDM callback means to the DevKit, after translation from the V2 or V3 wire format. */
export type TranslatedCallback = { kind: "consent"; requestId: string; event: ConsentEvent } | { kind: "data"; push: DataPush };

/**
 * Turns one raw callback into a DevKit event. Return `undefined` for callbacks the DevKit does not
 * handle. The V2 and V3 translators are added once their formats are confirmed in the sandbox.
 */
export type CallbackTranslator = (callback: BridgedCallback) => TranslatedCallback | undefined;

export interface CallbackHandlers {
  consent(callback: { requestId: string; event: ConsentEvent }): void | Promise<void>;
  data(push: DataPush): void | Promise<void>;
}

export interface BridgeInboxOptions {
  /** Bridge base URL, such as `https://abdm-bridge.example.com`. */
  baseUrl: string;
  inboxToken: string;
  translate: CallbackTranslator;
  fetch?: typeof fetch;
  /** Callbacks fetched per request; at most 100, the bridge's limit. */
  pageSize?: number;
}

export interface DrainResult {
  delivered: number;
  /** Callbacks no translator understood, or that could not be read; acknowledged so they do not pile up, and reported here. */
  unrecognised: { callback: BridgedCallback; error?: unknown }[];
  /** Callbacks whose handler threw; left in the inbox to retry on the next drain. */
  failed: { callback: BridgedCallback; error: unknown }[];
}

/**
 * Collects callbacks from the callback bridge and hands them to the workflows. A callback is
 * acknowledged, and so deleted from the bridge, only after its handler finished without error.
 *
 * Delivery is at least once: if an acknowledgement fails, or a handler failed and is retried after
 * later callbacks, a callback can arrive again or out of order. The DevKit's workflows are built for
 * this (repeated consent events are ignored, and only the first record push counts); custom handlers
 * must be too.
 */
export class BridgeInbox {
  readonly #o: Required<Omit<BridgeInboxOptions, "fetch">> & { fetch: typeof fetch };

  constructor(options: BridgeInboxOptions) {
    this.#o = { fetch: (...args) => fetch(...args), ...options, pageSize: Math.min(options.pageSize ?? 50, 100), baseUrl: options.baseUrl.replace(/\/+$/, "") };
  }

  /** Deliver everything waiting in the inbox, oldest first. */
  async drain(handlers: CallbackHandlers): Promise<DrainResult> {
    const result: DrainResult = { delivered: 0, unrecognised: [], failed: [] };
    let after = 0;
    for (;;) {
      const page = await this.#request<{ callbacks: BridgedCallback[]; next: number }>(`/v1/inbox?after=${after}&limit=${this.#o.pageSize}`);
      if (page.callbacks.length === 0) return result;
      const done: number[] = [];
      for (const callback of page.callbacks) {
        let translated: TranslatedCallback | undefined;
        try {
          translated = this.#o.translate(callback);
        } catch (error) {
          // A body that cannot be read now never will be; report it and move on.
          result.unrecognised.push({ callback, error });
          done.push(callback.id);
          continue;
        }
        if (!translated) {
          result.unrecognised.push({ callback });
          done.push(callback.id);
          continue;
        }
        try {
          if (translated.kind === "consent") await handlers.consent({ requestId: translated.requestId, event: translated.event });
          else await handlers.data(translated.push);
          result.delivered++;
          done.push(callback.id);
        } catch (error) {
          result.failed.push({ callback, error });
        }
      }
      if (done.length > 0) await this.#request("/v1/inbox/ack", { method: "POST", body: JSON.stringify({ ids: done }) });
      after = page.next;
    }
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#o.fetch(`${this.#o.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.#o.inboxToken}`, "content-type": "application/json" },
    });
    if (!response.ok) throw new Error(`Callback bridge returned ${response.status} for ${path.split("?")[0]}`);
    return (await response.json()) as T;
  }
}
