// Non-connecting smoke test for the parity harness itself.
//
// WHY THIS EXISTS
// The rest of this directory is gated behind `describe.skipIf(!hasDb)`, so
// with no PARITY_DATABASE_URL the entire suite skips and proves nothing about
// whether the harness still works. Two things can rot silently in that state:
//
//   1. The `?module` WASM loader in vitest.parity.config.ts. apps/api's
//      generated Prisma client targets the Cloudflare runtime and loads its
//      query compiler with `import("...query_compiler_fast_bg.wasm?module")`,
//      a Workers build convention nothing implements under plain Node. Without
//      the loader that config supplies, every route this suite drives fails at
//      makePrisma() and returns 500 — which reads as a route bug, not a
//      harness bug. That cost a full debugging cycle once already.
//
//   2. The skip gate itself. If `hasDb` ever defaulted to true, a run without
//      a database would attempt real connections instead of skipping.
//
// Both are checked here WITHOUT opening a connection, so this file runs on
// every parity invocation including CI and a developer laptop with no
// credentials. It is deliberately NOT skipIf-gated.
//
// SAFETY: nothing here opens a socket. The WASM assertion imports a file off
// disk; the remaining assertions read configuration. No connection string is
// used at all.
//
// NOTE ON HOW THIS TEST WAS ARRIVED AT: the first version asserted that
// `new PrismaClient({ adapter })` constructs successfully. A fool-test —
// deleting the plugin from vitest.parity.config.ts and re-running — showed it
// still passed, because the client loads its query compiler lazily on first
// query, not at construction. That test would have gone green forever while
// the loader rotted. It is replaced by a direct assertion on the import the
// loader actually serves, which the same fool-test does fail.

import { describe, expect, it } from "vitest";
import { hasDb, PARITY_URL } from "./_harness";

// The `?module` specifier is typed by ./wasm-module.d.ts — a build-tool
// convention TypeScript cannot resolve on its own.

describe("parity harness loads offline", () => {
  it("resolves the ?module WASM import, proving the loader in vitest.parity.config.ts is wired", async () => {
    const mod = await import(
      "../../src/generated/prisma/internal/query_compiler_fast_bg.wasm?module"
    );

    // Without the plugin this import rejects and the test fails loudly, which
    // is the whole point: the generated client would then 500 every route the
    // rest of this directory drives.
    expect(mod.default).toBeInstanceOf(WebAssembly.Module);
  });

  it("skips the database-backed suites when PARITY_DATABASE_URL is unset", () => {
    // Guards the gate rather than the database: hasDb must be derived from
    // the URL, never default to true.
    expect(hasDb).toBe(PARITY_URL.length > 0);
    if (!process.env.PARITY_DATABASE_URL) {
      expect(hasDb).toBe(false);
    }
  });

  it("never hard-codes a database URL in the harness", () => {
    // PARITY_URL must come from the environment only. A committed URL here
    // would put a live credential in the repository.
    expect(PARITY_URL).toBe(process.env.PARITY_DATABASE_URL ?? "");
  });
});
