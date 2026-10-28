import * as z from "zod/v4";
import { CONSENT_PURPOSES, HI_TYPES } from "@yellowparrottech/abdm-core";

// Request schemas validate what callers send; response schemas describe what the API returns and are
// checked against real responses in tests, so the published OpenAPI document cannot drift.

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date")
  .meta({ format: "date-time", example: "2025-01-01T00:00:00.000Z" });
const dateRange = z.object({ from: isoDate, to: isoDate }).meta({ description: "Inclusive period of the records" });
const hiType = z.enum(HI_TYPES).meta({ description: "Health information type" });
const purpose = z.enum(Object.keys(CONSENT_PURPOSES) as [keyof typeof CONSENT_PURPOSES]).meta({
  description: "ABDM consent purpose: CAREMGT care management, BTG break the glass, PUBHLTH public health, HPAYMT healthcare payment, DSRCH disease-specific research, PATRQT self requested",
});

export const consentRequestSchema = z
  .object({
    patientAbhaAddress: z.string().min(3).meta({ example: "asha.rao1@sbx" }),
    hiuId: z.string().min(1).meta({ description: "Your facility's HIU ID; the caller must be allowed to act for it", example: "HIU-DEMO-01" }),
    requesterName: z.string().min(1).meta({ example: "Dr Demo" }),
    purpose,
    hiTypes: z.array(hiType).min(1),
    dateRange,
    expiresAt: isoDate.meta({ description: "When access under this consent must end; must be in the future" }),
  })
  .meta({ id: "ConsentRequest" });

export const healthInfoRequestSchema = z
  .object({
    requestId: z.string().min(1).meta({ description: "The consent request the artefact was granted under" }),
    artefactId: z.string().min(1).meta({ description: "From the consent request's artefacts" }),
    hiTypes: z.array(hiType).min(1),
    dateRange,
  })
  .meta({ id: "HealthInfoRequest" });

export const confirmed = <T extends z.ZodType>(request: T, id: string) =>
  z
    .object({
      approvalId: z.string().min(1).meta({ description: "From the prepare call; works once and expires after 10 minutes" }),
      request: request.meta({ description: "Exactly the request that was prepared" }),
    })
    .meta({ id });

export const confirmedConsentRequestSchema = confirmed(consentRequestSchema, "ApprovedConsentRequest");
export const confirmedHealthInfoRequestSchema = confirmed(healthInfoRequestSchema, "ApprovedHealthInfoRequest");

export const pendingApprovalSchema = z
  .object({
    approvalId: z.string(),
    environment: z.enum(["mock", "sandbox", "certified"]),
    summary: z.array(z.string()).meta({ description: "Plain-English lines to show the person approving" }),
    expiresAt: z.string(),
  })
  .meta({ id: "PendingApproval" });

const artefactSchema = z.object({ id: z.string(), hipId: z.string(), hiTypes: z.array(hiType), dateRange, expiresAt: z.string() });

export const consentStatusSchema = z
  .object({
    requestId: z.string(),
    consentRequestId: z.string().optional().meta({ description: "ABDM's ID, once it acknowledges the request" }),
    state: z.enum(["requested", "pending_patient", "granted", "denied", "expired", "revoked", "failed"]),
    artefacts: z.array(artefactSchema).meta({ description: "What the patient approved; may be narrower than the request" }),
    updatedAt: z.string(),
  })
  .meta({ id: "ConsentStatus" });

export const consentListSchema = z.object({ consentRequests: z.array(consentStatusSchema) }).meta({ id: "ConsentList" });

export const healthInfoResultSchema = z
  .object({
    transactionId: z.string(),
    state: z.enum(["requested", "received", "failed", "discarded"]),
    contentExposed: z.boolean().meta({ description: "Whether record content is included; false means metadata only" }),
    records: z.array(
      z.object({
        hiType,
        careContextReference: z.string(),
        sizeBytes: z.number(),
        bundle: z.unknown().optional().meta({ description: "Decrypted FHIR document bundle, when content is exposed" }),
      }),
    ),
    failure: z.string().optional(),
  })
  .meta({ id: "HealthInfoResult" });

export const transferListSchema = z
  .object({
    transfers: z.array(
      z.object({
        transactionId: z.string(),
        requestId: z.string(),
        state: z.enum(["requested", "received", "failed", "discarded"]),
        recordCount: z.number(),
        failure: z.string().optional(),
      }),
    ),
  })
  .meta({ id: "TransferList" });

export const validationReportSchema = z
  .object({
    valid: z.boolean(),
    hiType: hiType.optional(),
    issues: z.array(z.object({ severity: z.enum(["error", "warning"]), path: z.string(), message: z.string() })),
  })
  .meta({ id: "ValidationReport" });

export const errorSchema = z
  .object({
    error: z
      .object({
        code: z.string().meta({ description: "Machine-readable reason, such as approval_not_found or hi_type_not_consented" }),
        detail: z.string().optional(),
      })
      .passthrough(),
  })
  .meta({ id: "Error" });
