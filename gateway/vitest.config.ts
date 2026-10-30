import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared/ocpp": path.resolve(__dirname, "../src/lib/ocpp"),
      "@engine": path.resolve(__dirname, "../src/lib/ocpp-engine"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
