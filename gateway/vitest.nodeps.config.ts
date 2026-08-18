// Dependency-free vitest config.
//
// `gateway/vitest.config.ts` opens with `import { defineConfig } from "vitest/config"`,
// which Node resolves relative to THIS directory — and this worktree has no
// `node_modules`. That single import is the entire reason the gateway suite could
// not be run here, reported as a blocker twice without being attacked.
//
// This config imports nothing at all, so it loads under a vitest binary resolved
// from anywhere on the machine — including a sibling worktree that does have its
// dependencies installed. It carries the same aliases as the real config.
//
// It is a way to RUN the suite, not a replacement for it. `vitest.config.ts`
// stays the config of record for CI.
export default {
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
      "@shared/ocpp": new URL("../src/lib/ocpp/", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
};
