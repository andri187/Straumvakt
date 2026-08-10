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
    // scripts/**/*.test.mjs covers offline guards for standalone assets in
    // public/ (see scripts/dso-poc.test.mjs). Without this line those tests
    // are silently never collected, which is worse than having none.
    include: ["src/**/*.test.ts", "apps/api/src/**/*.test.ts", "scripts/**/*.test.mjs"],
    globals: false,
  },
});
