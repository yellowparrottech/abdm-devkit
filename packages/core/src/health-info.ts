import type { DateRange, HiType } from "./vocabulary.js";

/** The HIU's public key and nonce for one transfer. The private half never leaves the HIU. */
export interface HiuKeyMaterial {
  /** X.509 public key, base64. */
  publicKey: string;
  nonce: string;
  expiresAt: string;
}

/** What an HIU sends to request records under a consent artefact. */
export interface HealthInfoGatewayRequest {
  consentArtefactId: string;
  hiTypes: HiType[];
  dateRange: DateRange;
  keyMaterial: HiuKeyMaterial;
}

/** One encrypted record pushed by a HIP. */
export interface DataPushEntry {
  careContextReference: string;
  hiType: HiType;
  media: "application/fhir+json";
  /** Encrypted FHIR bundle, base64. */
  content: string;
}

/** A HIP's delivery of encrypted records for one transfer. */
export interface DataPush {
  transactionId: string;
  entries: DataPushEntry[];
  /** The HIP's public key and nonce, needed to decrypt. */
  keyMaterial: { publicKey: string; nonce: string };
}
