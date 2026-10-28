# @yellowparrottech/abdm-workflows

ABDM workflows with no MCP or AI dependency. HMIS backends, the REST adapter and the MCP adapter all call these.

- `ConsentWorkflows`: prepare a consent request (validated and authorised, returning a summary the person approves), submit it once approved, apply gateway callbacks, read status, and authorise fetches against the consent.
- `HealthInfoWorkflows`: request records under a granted consent (approved by a person, re-checked on submit), decrypt the HIP's push server-side with a key pair made for that transfer, and return results. Consent is re-checked on every read; once it lapses, stored records are discarded. Record content is returned only in `mock` or a declared controlled deployment; otherwise callers get metadata only.
- `ApprovalBook`: approvals bound to one actor and one exact payload; each works once and expires.
- Every call names the authenticated `Actor`; one actor cannot see or use another actor's requests, transfers or approvals. Every decision is audited without patient details or record content.

Pre-release; not yet published to npm.
