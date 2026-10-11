import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Tests for the attachment organizer (src/steward), which bring their own
// Obsidian mock - see test-steward/mocks/obsidian.ts.
export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(dirname, "test-steward/mocks/obsidian.ts"),
    },
  },
  test: {
    include: ["test-steward/**/*.test.ts"],
    setupFiles: ["test-steward/setup.ts"],
  },
});
