# Contributing

Thanks for helping. The project is in Phase 0, so expect the structure to change.

## Setup

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

Node.js 22 or later is required.

## Rules for every contribution

1. **Synthetic data only.** Never commit, paste or attach real patient data, ABHA numbers, Aadhaar numbers, OTPs or credentials, including in issues and pull requests.
2. **No copied ABDM material.** Write schemas and tests from scratch. Do not commit NHA Postman collections, sandbox documents or anything from behind the sandbox login.
3. **Terminology licensing.** Use SNOMED CT codes only from the SNOMED IPS free set, and LOINC codes with attribution. Never commit SNOMED release files.
4. **Licences of dependencies.** Only add dependencies with an OSI-approved licence compatible with Apache-2.0. Code without a licence cannot be copied in.
5. **Security first.** Changes that touch authorisation, consent, encryption or what an AI model can see need a test showing the unsafe case is rejected.

## Pull requests

- Keep each pull request focused on one change.
- `pnpm typecheck` and `pnpm test` must pass.
- Describe what changed and how you tested it.

By contributing, you agree that your contributions are licensed under the Apache License 2.0.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
