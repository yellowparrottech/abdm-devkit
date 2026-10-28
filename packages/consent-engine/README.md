# @yellowparrottech/abdm-consent-engine

Consent state machine and scope policy for ABDM HIU consent flows.

- `createConsentTransaction` and `applyConsentEvent` track a request through `requested`, `pending_patient`, `granted`, `denied`, `expired`, `revoked` or `failed`. Replayed callbacks (same event ID) change nothing, and a decision may arrive before the gateway's acknowledgement.
- A grant wider than the request (extra HI types, wider dates, later expiry, another HIU or purpose) is rejected.
- `checkHealthInfoRequest` allows a fetch only inside a granted, unexpired artefact, for the requesting HIU, HI types and dates it covers.

Pre-release; not yet published to npm.
