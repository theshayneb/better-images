import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The real npm "obsidian" package ships types only (no runtime) — see
      // test/mocks/obsidian.ts for why and what it provides instead.
      obsidian: path.resolve(dirname, "test/mocks/obsidian.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
