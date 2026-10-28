// Bundles the mock MCP server into one file and packs it as a Claude Desktop extension (.mcpb).
// Run `pnpm build` first.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["apps/mcp-server/dist/main.js"],
  outfile: "mcpb/server/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Some bundled CommonJS dependencies call require(); give ESM output one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "linked",
  logLevel: "warning",
});

mkdirSync("build", { recursive: true });
execFileSync("pnpm", ["exec", "mcpb", "pack", "mcpb", "build/abdm-devkit.mcpb"], { stdio: "inherit" });
