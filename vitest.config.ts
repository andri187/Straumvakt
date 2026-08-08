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
    include: ["src/**/*.test.ts", "apps/api/src/**/*.test.ts", "packages/**/*.test.ts"],
    globals: false,
  },
});
