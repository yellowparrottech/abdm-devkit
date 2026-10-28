# Tests

Cross-package suites: `contract/` (schemas against recorded sandbox exchanges), `security/` (rejected unsafe cases) `integration/` (end-to-end workflows on the mock gateway) and `e2e/` (the built MCP server over stdio; skipped until `pnpm build` has run). Unit tests live next to the code in each package.
