# @yellowparrottech/abdm-rest-adapter

HTTP API over `@yellowparrottech/abdm-workflows`, for HMIS backends and scripts that do not use MCP. Built on Hono, so it runs on Node.js, Cloudflare Workers or any Fetch runtime.

| Method and path | What it does |
| --- | --- |
| `POST /v1/consent-requests/prepare` | Validate and authorise a consent request; returns the summary your app shows its user |
| `POST /v1/consent-requests` | Send it: `{ approvalId, request }` with the same request |
| `GET /v1/consent-requests`, `GET /v1/consent-requests/:requestId` | List or read consent requests |
| `POST /v1/health-info-requests/prepare`, `POST /v1/health-info-requests` | Same two steps for fetching records |
| `GET /v1/health-info-requests`, `GET /v1/health-info-requests/:transactionId` | List fetches or read received records |
| `POST /v1/fhir/validate` | Structural checks for a FHIR document bundle |

- The host supplies `authenticate(request)`, which maps a request to an actor (for example from a bearer token). Unknown callers get 401.
- An approval works once, expires, and only for the exact request that was prepared; a mismatch returns 409.
- Workflow errors map to 400, 403, 404 or 409 with `{ "error": { "code": ... } }`.

Pre-release; not yet published to npm.
