import * as z from "zod/v4";
import {
  confirmedConsentRequestSchema,
  confirmedHealthInfoRequestSchema,
  consentListSchema,
  consentRequestSchema,
  consentStatusSchema,
  errorSchema,
  healthInfoRequestSchema,
  healthInfoResultSchema,
  pendingApprovalSchema,
  transferListSchema,
  validationReportSchema,
} from "./schemas.js";

const components = {
  ConsentRequest: consentRequestSchema,
  HealthInfoRequest: healthInfoRequestSchema,
  ApprovedConsentRequest: confirmedConsentRequestSchema,
  ApprovedHealthInfoRequest: confirmedHealthInfoRequestSchema,
  PendingApproval: pendingApprovalSchema,
  ConsentStatus: consentStatusSchema,
  ConsentList: consentListSchema,
  HealthInfoResult: healthInfoResultSchema,
  TransferList: transferListSchema,
  ValidationReport: validationReportSchema,
  Error: errorSchema,
};

const ref = (name: keyof typeof components) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: keyof typeof components) => ({ content: { "application/json": { schema: ref(name) } } });
const errors = (...codes: (400 | 401 | 403 | 404 | 409)[]) => {
  const text = {
    400: "The request is missing something or is invalid; `detail` says what",
    401: "No bearer token, or the wrong one",
    403: "Not allowed: the user cannot act for that facility, or the patient did not agree to this",
    404: "Not found, or it belongs to another user",
    409: "The approval is missing, already used, expired, or was for a different request",
  };
  return Object.fromEntries(codes.map((code) => [String(code), { description: text[code], ...json("Error") }]));
};
const idParam = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });

/** OpenAPI 3.1 description of the REST API, generated from the same schemas the API validates with. */
export function createOpenApiDocument() {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(components)) registry.add(schema, { id });
  const generated = z.toJSONSchema(registry, { uri: (id) => `#/components/schemas/${id}`, unrepresentable: "any" }).schemas;
  // OpenAPI components are plain schema objects; drop the standalone-document keys.
  const schemas = Object.fromEntries(Object.entries(generated).map(([id, { $schema: _s, $id: _i, ...schema }]) => [id, schema]));

  return {
    openapi: "3.1.0",
    info: {
      title: "YellowParrot ABDM DevKit REST API",
      version: "0.1.0",
      description:
        "Consent requests, record fetches and FHIR checks over HTTP. Anything that sends a request to ABDM takes two calls: prepare returns a summary to show a person, then send posts the approval ID with the same request. Unofficial; not affiliated with NHA. Tested against the built-in practice ABDM only.",
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [{ url: "http://127.0.0.1:8787", description: "abdm-devkit mock (practice ABDM)" }],
    security: [{ bearer: [] }],
    paths: {
      "/v1/consent-requests/prepare": {
        post: {
          summary: "Prepare a consent request",
          description: "Validates and authorises the request and returns a summary to show the person approving. Nothing is sent to ABDM.",
          requestBody: { required: true, ...json("ConsentRequest") },
          responses: { "200": { description: "Ready to approve", ...json("PendingApproval") }, ...errors(400, 401, 403) },
        },
      },
      "/v1/consent-requests": {
        post: {
          summary: "Send an approved consent request",
          description: "Sends exactly the prepared request. Each approval works once, for one user, within 10 minutes.",
          requestBody: { required: true, ...json("ApprovedConsentRequest") },
          responses: { "201": { description: "Sent to ABDM", ...json("ConsentStatus") }, ...errors(400, 401, 403, 409) },
        },
        get: {
          summary: "List your consent requests",
          responses: { "200": { description: "Your consent requests, oldest first", ...json("ConsentList") }, ...errors(401) },
        },
      },
      "/v1/consent-requests/{requestId}": {
        get: {
          summary: "Get a consent request",
          description: "Poll until state is granted, denied, expired, revoked or failed.",
          parameters: [idParam("requestId", "From the send response")],
          responses: { "200": { description: "Current state", ...json("ConsentStatus") }, ...errors(401, 404) },
        },
      },
      "/v1/health-info-requests/prepare": {
        post: {
          summary: "Prepare a record fetch",
          description: "Checks the fetch against what the patient approved and returns a summary. Nothing is sent to ABDM.",
          requestBody: { required: true, ...json("HealthInfoRequest") },
          responses: { "200": { description: "Ready to approve", ...json("PendingApproval") }, ...errors(400, 401, 403, 404) },
        },
      },
      "/v1/health-info-requests": {
        post: {
          summary: "Send an approved record fetch",
          requestBody: { required: true, ...json("ApprovedHealthInfoRequest") },
          responses: { "201": { description: "Sent to ABDM", ...json("HealthInfoResult") }, ...errors(400, 401, 403, 404, 409) },
        },
        get: {
          summary: "List your record fetches",
          responses: { "200": { description: "Your fetches, with states and record counts", ...json("TransferList") }, ...errors(401) },
        },
      },
      "/v1/health-info-requests/{transactionId}": {
        get: {
          summary: "Get received records",
          description: "Poll until state is received, failed or discarded. Consent is checked again on every read.",
          parameters: [idParam("transactionId", "From the send response")],
          responses: { "200": { description: "Records, or their metadata", ...json("HealthInfoResult") }, ...errors(401, 403, 404) },
        },
      },
      "/v1/fhir/validate": {
        post: {
          summary: "Check a FHIR document bundle",
          description: "Structural checks only: bundle shape, an NRCeS record profile on the Composition, and references that resolve.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
          responses: { "200": { description: "Check report", ...json("ValidationReport") }, ...errors(400, 401) },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Mapped to a user by the host's authenticate function" } },
      schemas,
    },
  };
}
