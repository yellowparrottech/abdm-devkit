# YellowParrot ABDM DevKit

Build, simulate and validate ABDM integrations without starting with live credentials.

An unofficial, open-source toolkit for building software that connects to ABDM (the Ayushman Bharat Digital Mission), India's national system for sharing health records with the patient's consent. It includes a practice version of ABDM with made-up data, building blocks for consent, encryption and health records, a REST API for any language, and tools for AI assistants such as Claude.

**Documentation:** [abdm.yellowparrottech.com](https://abdm.yellowparrottech.com). New to ABDM? Start with [ABDM in plain words](https://abdm.yellowparrottech.com/start/abdm-basics/), and see the [glossary](https://abdm.yellowparrottech.com/reference/glossary/) for terms like HIP, HIU and M1/M2/M3.

> **Status: pre-alpha.** The mock environment works end to end (consent, encrypted record transfer, decryption, FHIR checks) through MCP, REST and TypeScript. Sandbox and production connectivity are not built yet. Nothing is published to npm.

> **Unofficial.** This project is not affiliated with, endorsed by or certified by the National Health Authority (NHA) or ABDM. "ABDM" and "ABHA" are used only to describe compatibility.

## What it includes

| Part | Package | Purpose |
| --- | --- | --- |
| Core | `@yellowparrottech/abdm-core` | Shared ABDM vocabulary, clock and result types |
| Workflows | `@yellowparrottech/abdm-workflows` | Consent workflows, approvals, authorisation and audit, with no MCP dependency |
| ABDM client | `@yellowparrottech/abdm-client` | Typed V2/V3 HTTP client with per-flow version selection |
| Consent engine | `@yellowparrottech/abdm-consent-engine` | Consent artefacts and policy checks |
| Crypto | `@yellowparrottech/abdm-crypto` | ABDM's ECDH encryption scheme for health-information transfer |
| FHIR | `@yellowparrottech/abdm-fhir` | Builders and validation for the NRCeS ABDM profiles (IG 6.5.0) |
| Mock gateway | `@yellowparrottech/abdm-mock-gateway` | Deterministic, offline ABDM with consent and callback scenarios |
| Fixtures | `@yellowparrottech/abdm-fixtures` | Seeded synthetic patients, consents and FHIR bundles |
| MCP adapter and server | `@yellowparrottech/abdm-mcp-adapter`, `@yellowparrottech/abdm-mcp-server` | Workflow tools for AI agents, with server-side policy |
| REST adapter | `@yellowparrottech/abdm-rest-adapter` | HTTP API over the core for non-TypeScript apps |
| Callback bridge | `@yellowparrottech/abdm-callback-bridge` | Self-hosted receiver for ABDM callbacks |
| CLI | `@yellowparrottech/abdm-devkit` | `mock` runs the mock environment as a local REST API |

## Environments

| Environment | Needs | Use |
| --- | --- | --- |
| `mock` (default) | Nothing | Demos, CI, learning the flows; simulated writes are labelled synthetic |
| `sandbox` | Your own ABDM sandbox credentials | Building toward ABDM certification |
| `certified` | An operator's certified ABDM service | Production use, governed by that operator |

Real external writes are off by default. Production access requires your own ABDM onboarding and certification; this toolkit does not provide it.

## Safety principles

- Aadhaar numbers and OTPs never enter an AI model's context.
- Real patient records are not exposed to general-purpose AI agents by default.
- Authorisation is enforced on the server; MCP tool hints are not treated as security controls.
- Every operation that moves health data needs an approval bound to that exact transaction.
- The repository contains synthetic data only. Never add real patient data to issues, tests or fixtures.

## Roadmap

| Phase | Outcome |
| --- | --- |
| 0. Technical validation | Verified sandbox transaction, compatibility matrix |
| 1. Mock-first MVP (v0.1) | Offline consent-and-fetch workflow in under 5 minutes |
| 2. Live sandbox (v0.5) | End-to-end sandbox consent and encrypted retrieval |
| 3. Complete toolkit (v1.0) | HIP workflows, all eight FHIR profiles, registry lookups |

## Development

Requires Node.js 22 or later and pnpm (via Corepack).

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

Try the mock environment (synthetic data only, no ABDM credentials):

- In Claude Desktop: [examples/claude-desktop](examples/claude-desktop/README.md)
- Over REST from any language: `node apps/cli/dist/main.js mock`, then [examples/python](examples/python/README.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project rules.

## Not a medical device

This software is an integration and testing toolkit. It does not provide medical advice or clinical decision support, and output from AI models can be wrong.

## Licence

[Apache License 2.0](LICENSE). The licence lets anyone use and deploy this software. YellowParrot Technologies' own policy of not operating production services for others is separate from what the licence permits.

Built by [YellowParrot Technologies](https://yellowparrottech.com).
