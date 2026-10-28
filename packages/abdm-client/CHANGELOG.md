# @yellowparrottech/abdm-client

## 0.1.0

### Minor Changes

- 8c8fe47: Add BridgeInbox, which collects callbacks from the callback bridge and acknowledges each only after it has been handled.
- 8c8fe47: First public release: the practice ABDM, consent and record-fetch workflows with approvals and audit, ABDM-compatible encryption, FHIR document building and checks, eight MCP tools, a REST API and a command-line tool.

### Patch Changes

- 8c8fe47: BridgeInbox reports callbacks its translator cannot read instead of stopping, and caps pages at 100.
- Updated dependencies [8c8fe47]
  - @yellowparrottech/abdm-core@0.1.0
  - @yellowparrottech/abdm-consent-engine@0.1.0
