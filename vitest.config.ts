import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // packages/** added 2026-08-08 with the commercial harvest. Without it
    // the 566 lines of resolver tests that moved into packages/commercial
    // would have silently stopped running — the files exist, the suite just
    // never looks at them, and a green run means nothing.
    // scripts/**/*.test.mjs added 2026-08-08. The check scripts had no test
    // surface at all, so a guard added to one of them could not be covered
    // without inventing one. Deliberately narrow: .mjs only, which today
    // matches exactly one file and cannot pull in application code.
    include: [
      "src/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "scripts/**/*.test.mts",
    ],
    globals: false,
  },
});
