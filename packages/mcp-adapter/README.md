# @yellowparrottech/abdm-mcp-adapter

MCP tools over `@yellowparrottech/abdm-workflows`, built on the MCP TypeScript SDK v2.

| Tool | What it does |
| --- | --- |
| `abdm_demo_scenarios` | Mock only: list how the simulated patient can respond |
| `abdm_consent_request` | Ask the user to confirm the exact request, then send it |
| `abdm_consent_status` | Current state of a request made from this deployment |
| `abdm_health_info_request` | Ask the user to confirm, then request records under a granted consent |
| `abdm_health_info_result` | Records received for a fetch: content where allowed, otherwise types and sizes |
| `abdm_workflow_status` | Every consent request and fetch by the current user, with its state |
| `abdm_fhir_generate` | Build a FHIR document bundle for an HI type, with its validation report |
| `abdm_fhir_validate` | Structural checks for a FHIR document bundle |

- The actor, HIU ID and requester name are set by the host, never by the model.
- Requests are confirmed through MCP elicitation. A client that cannot ask the user gets an error and nothing is sent. In the mock environment the prompt is labelled as synthetic.
- The confirmation round trip carries only an approval ID; the workflows re-check it against the exact arguments before sending.
- Returned record content is capped at 60,000 characters per call and comes with a notice that it is untrusted data.

Pre-release; not yet published to npm.
