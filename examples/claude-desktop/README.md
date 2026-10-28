# Claude Desktop: mock consent and record fetch

Runs the DevKit's MCP server in mock mode with synthetic data only. No ABDM credentials are needed.

## Set up

### Option A: install as an extension

1. Build the extension: `pnpm install && pnpm bundle:mcpb`. This writes `build/abdm-devkit.mcpb`.
2. Open the file with Claude Desktop (or Settings → Extensions → Install from file) and confirm.

The extension bundles everything it needs into one file and runs on the Node.js that Claude Desktop provides.

### Option B: point Claude Desktop at your build

1. Build the repository: `pnpm install && pnpm build`.
2. Open Claude Desktop's config file (Settings → Developer → Edit Config) and add the server. Use absolute paths: Claude Desktop does not load your shell's `PATH`.

   ```json
   {
     "mcpServers": {
       "abdm-devkit": {
         "command": "/absolute/path/to/node",
         "args": ["/absolute/path/to/abdm-devkit/apps/mcp-server/dist/main.js"]
       }
     }
   }
   ```

   `which node` prints the Node.js path (Node 22 or later).
3. Restart Claude Desktop. The server's tools appear under the tools menu.

The server needs a client that supports MCP elicitation, because every consent request and record fetch asks you to confirm it. If your client does not support it, those tools return an error and nothing is sent.

## Demo script

Say these to Claude, one at a time:

1. "What mock consent scenarios are available?"
2. "Request consent from asha.rao1@sbx for care management, for prescriptions and diagnostic reports from 2025, valid until the end of next month." Confirm the request when asked.
3. "Check the status of that consent." The simulated patient approves after a few seconds.
4. "Fetch the prescriptions under that consent." Confirm when asked.
5. "Show me the records you received." The bundle arrives encrypted, is decrypted inside the server, and is returned as synthetic FHIR.
6. "Now request consent again, but use the deny scenario," then "Try to fetch records under it." The fetch is refused.

Mock state lives in memory and resets when the server restarts.
