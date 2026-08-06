import { defineConfig } from "vitest/config";

// Separate from the main suite on purpose.
//
// These tests need a live Postgres. The main suite is offline, runs in about
// a second, and its count (649 passed / 1 skipped) is a gate that people read
// — adding a couple of dozen conditionally-skipped tests to it would move that
// number without meaning anything.
//
// Run with:
//   PARITY_DATABASE_URL=... npm --prefix apps/api run test:parity
//
// The URL must point at the Neon TEST branch (br-withered-hat-abtc5gzi,
// project spring-leaf-73019190). Everything here is read-only, but "read-only
// by inspection" is not a guarantee — point it at test.

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/parity/**/*.test.ts"],
    globals: false,
    // A cold Neon compute takes a few seconds to wake.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Serial: these share one connection pool against one branch.
    fileParallelism: false,
  },
});
