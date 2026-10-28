---
title: REST API
description: Endpoints of the DevKit's REST adapter.
---

All paths start with `/v1` and need `Authorization: Bearer <token>`. Anything that sends a request uses two calls: `prepare` returns a summary for your user, then you send the `approvalId` with the same request. The [curl walkthrough](/guides/rest-api/) shows every call with real responses.

**Machine-readable description:** [OpenAPI 3.1](/openapi.json), also served by every running DevKit at `GET /v1/openapi.json`. It is generated from the same schemas the API validates with, and the test suite checks every real response against it. Use it to generate clients in Go, Java, Python or other languages.

**Status:** all endpoints are mock-tested; none have yet been run against ABDM's test system.

| Method and path | What it does |
| --- | --- |
| `POST /consent-requests/prepare` | Validate and authorise a consent request; returns `approvalId` and `summary` |
| `POST /consent-requests` | Send it: `{ "approvalId", "request" }` with the same request |
| `GET /consent-requests` | Your consent requests |
| `GET /consent-requests/:requestId` | One consent request, and what the patient approved |
| `POST /health-info-requests/prepare` | Check a record fetch against what the patient approved |
| `POST /health-info-requests` | Send it: `{ "approvalId", "request" }` |
| `GET /health-info-requests` | Your fetches |
| `GET /health-info-requests/:transactionId` | Records received for a fetch |
| `POST /fhir/validate` | Check a health record's structure (FHIR) |

## Errors

Errors return `{ "error": { "code": "..." } }`:

| Status | Meaning |
| --- | --- |
| `400` | Something in the request is missing or invalid; `detail` says what |
| `401` | No token, or the wrong token |
| `403` | Not allowed: your user cannot act for that facility, or the patient did not agree to this |
| `404` | Not found, or it belongs to another user |
| `409` | The approval is missing, already used, expired, or was for a different request |
