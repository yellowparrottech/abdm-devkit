# @yellowparrottech/abdm-mcp-server

Runnable MCP server for the YellowParrot ABDM DevKit, over stdio. This release runs the mock environment only: a simulated ABDM gateway and HIP with synthetic data, on real time so each step is visible.

```sh
pnpm build
node apps/mcp-server/dist/main.js
```

- Tools: see `@yellowparrottech/abdm-mcp-adapter`.
- `ABDM_ENV` defaults to `mock`; other values exit with an error until sandbox support lands (v0.5).
- `ABDM_MOCK_FAST=1` shortens the simulated delays, for automated tests.
- Status messages go to stderr; stdout carries the MCP protocol.

Claude Desktop setup and a demo script: `examples/claude-desktop/README.md`.

Pre-release; not yet published to npm.
