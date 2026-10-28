# @yellowparrottech/abdm-mock-gateway

Deterministic, offline stand-in for the ABDM gateway and one HIP, running on simulated time.

- Consent: `requestConsent` acknowledges the request and delivers the simulated patient's decision. Scenarios: `approve`, `approve_narrower`, `deny`, `expire`, `lost_notification`, `duplicate_notification`, `late_acknowledgement`.
- Health information: `requestHealthInfo` encrypts synthetic FHIR bundles for the HIU's key with ABDM's scheme and pushes them, as a HIP would.
- `advance(ms)` and `runUntilIdle()` deliver due callbacks in order.

Callbacks are currently domain events. V2 and V3 wire formats come with the client adapters (see `docs/adr/0001`).

Pre-release; not yet published to npm.
