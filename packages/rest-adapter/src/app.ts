import { Hono, type Context } from "hono";
import * as z from "zod/v4";
import { validateDocumentBundle } from "@yellowparrottech/abdm-fhir";
import type { Actor, ConsentWorkflows, HealthInfoWorkflows, WorkflowError } from "@yellowparrottech/abdm-workflows";
import { createOpenApiDocument } from "./openapi.js";
import { confirmedConsentRequestSchema, confirmedHealthInfoRequestSchema, consentRequestSchema, healthInfoRequestSchema } from "./schemas.js";

export interface RestAppOptions {
  consents: ConsentWorkflows;
  healthInfo: HealthInfoWorkflows;
  /** Map a request to the authenticated actor, for example from a bearer token. Return undefined to reject it. */
  authenticate(request: Request): Actor | undefined | Promise<Actor | undefined>;
}

const STATUS: Record<WorkflowError["code"], 400 | 403 | 404 | 409> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  approval_not_found: 409,
  approval_expired: 409,
  approval_already_used: 409,
  consent_not_granted: 403,
  consent_expired: 403,
  unknown_artefact: 404,
  wrong_requester: 403,
  hi_type_not_consented: 403,
  date_range_outside_consent: 403,
};

type Env = { Variables: { actor: Actor } };

/**
 * HTTP API over the workflows, for HMIS backends and scripts. Requests that send anything follow
 * the same two steps as the MCP tools: `prepare` returns a summary the app shows its user, then the
 * app posts the approval ID with the same request. Runs on Node.js, Workers or any Fetch runtime.
 */
export function createRestApp(options: RestAppOptions): Hono<Env> {
  const { consents, healthInfo } = options;
  const app = new Hono<Env>().basePath("/v1");

  // The API description is public; registered before the authentication middleware.
  app.get("/openapi.json", (c) => c.json(createOpenApiDocument()));

  app.use(async (c, next) => {
    const actor = await options.authenticate(c.req.raw);
    if (!actor) return c.json({ error: { code: "unauthenticated" } }, 401);
    c.set("actor", actor);
    await next();
  });

  app.post("/consent-requests/prepare", async (c) => {
    const body = await parse(c, consentRequestSchema);
    if (!body.ok) return body.response;
    return reply(c, consents.prepareConsentRequest(c.get("actor"), body.value));
  });

  app.post("/consent-requests", async (c) => {
    const body = await parse(c, confirmedConsentRequestSchema);
    if (!body.ok) return body.response;
    return reply(c, await consents.submitApprovedConsentRequest(c.get("actor"), body.value.approvalId, body.value.request), 201);
  });

  app.get("/consent-requests", (c) => c.json({ consentRequests: consents.listConsentRequests(c.get("actor")) }));
  app.get("/consent-requests/:requestId", (c) => reply(c, consents.getConsentStatus(c.get("actor"), c.req.param("requestId"))));

  app.post("/health-info-requests/prepare", async (c) => {
    const body = await parse(c, healthInfoRequestSchema);
    if (!body.ok) return body.response;
    return reply(c, healthInfo.prepareHealthInfoRequest(c.get("actor"), body.value));
  });

  app.post("/health-info-requests", async (c) => {
    const body = await parse(c, confirmedHealthInfoRequestSchema);
    if (!body.ok) return body.response;
    return reply(c, await healthInfo.submitApprovedHealthInfoRequest(c.get("actor"), body.value.approvalId, body.value.request), 201);
  });

  app.get("/health-info-requests", (c) => c.json({ transfers: healthInfo.listTransfers(c.get("actor")) }));
  app.get("/health-info-requests/:transactionId", (c) => reply(c, healthInfo.getHealthInfoResult(c.get("actor"), c.req.param("transactionId"))));

  app.post("/fhir/validate", async (c) => {
    const body = await parse(c, z.record(z.string(), z.unknown()));
    if (!body.ok) return body.response;
    return c.json(validateDocumentBundle(body.value));
  });

  return app;
}

async function parse<T extends z.ZodType>(c: Context<Env>, schema: T): Promise<{ ok: true; value: z.infer<T> } | { ok: false; response: Response }> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const detail = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
  return { ok: false, response: c.json({ error: { code: "invalid_request", detail } }, 400) };
}

function reply<T>(c: Context<Env>, result: { ok: true; value: T } | { ok: false; error: WorkflowError }, status: 200 | 201 = 200): Response {
  return result.ok ? c.json(result.value as object, status) : c.json({ error: result.error }, STATUS[result.error.code]);
}
