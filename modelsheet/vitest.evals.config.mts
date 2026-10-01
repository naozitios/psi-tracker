import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Evals hit real services (Claude API, SEC EDGAR) and are never part of
// `npm test`. Each also needs an explicit opt-in variable to run.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["evals/**/*.eval.ts"],
    testTimeout: 15 * 60 * 1000,
  },
});
