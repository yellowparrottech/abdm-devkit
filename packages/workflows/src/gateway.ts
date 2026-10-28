import type { ConsentEvent, ConsentRequestInput } from "@yellowparrottech/abdm-consent-engine";

/** Sends consent requests to ABDM (mock, sandbox or certified). Results come back through `handleConsentCallback`. */
export interface ConsentGatewayPort {
  submitConsentRequest(requestId: string, request: ConsentRequestInput): void | Promise<void>;
}

export interface ConsentCallback {
  requestId: string;
  event: ConsentEvent;
}
