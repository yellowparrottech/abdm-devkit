// Writes the REST API's OpenAPI document into the docs site, from the built rest-adapter package.
// Run `pnpm build` first.
import { writeFileSync } from "node:fs";
import { createOpenApiDocument } from "../packages/rest-adapter/dist/index.js";

const target = new URL("../docs/public/openapi.json", import.meta.url);
writeFileSync(target, JSON.stringify(createOpenApiDocument(), null, 2) + "\n");
console.log(`Wrote ${target.pathname}`);
