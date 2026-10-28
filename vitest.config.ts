import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Tests import workspace packages by name; point those imports at source so no build is needed first.
const alias = ["apps", "packages"].flatMap((group) =>
  readdirSync(group).map((dir) => {
    const { name } = JSON.parse(readFileSync(resolve(group, dir, "package.json"), "utf8")) as { name: string };
    return { find: name, replacement: resolve(group, dir, "src/index.ts") };
  }),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
