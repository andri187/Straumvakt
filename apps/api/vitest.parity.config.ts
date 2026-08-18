import { defineConfig, type Plugin } from "vitest/config";

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

/**
 * Let the Worker-runtime Prisma client instantiate under Node.
 *
 * apps/api's generated client targets the Cloudflare runtime: it drives a
 * WebAssembly query compiler and loads it with
 *
 *     await import("./query_compiler_fast_bg.wasm?module")
 *
 * (generated/prisma/internal/class.ts). `?module` is a Workers/Vite build
 * convention meaning "give me a compiled WebAssembly.Module, not a URL or
 * bytes". Nothing in a plain Node + Vite pipeline implements it, so the
 * import throws and every route that calls makePrisma() 500s — which is how
 * this reads from the outside, and why it looks like a route bug when it is
 * really a missing loader.
 *
 * Until this file existed, the parity harness sidestepped the whole problem
 * by using the OTHER generated client (prisma/generated/node-client) and only
 * ever calling repository functions directly — see the getApiPrisma() comment
 * in test/parity/_harness.ts. Tests that drive real HTTP routes cannot do
 * that: the route mints its own client from c.env and never sees ours.
 *
 * So implement `?module` for Node: compile the .wasm off disk at import time.
 * This is test plumbing only — production still gets the Workers loader — and
 * it means the route tests exercise the same client shipped to Cloudflare
 * rather than a Node-flavoured stand-in.
 */
function wasmModulePlugin(): Plugin {
  const SUFFIX = "?module";
  const MARK = "\0parity-wasm-module:";

  return {
    name: "parity-wasm-module",
    // Ahead of vite's own asset handling, which would otherwise turn the
    // .wasm into a URL string long before we get a look at it.
    enforce: "pre",

    async resolveId(source, importer) {
      if (!source.endsWith(`.wasm${SUFFIX}`)) return null;
      const bare = source.slice(0, -SUFFIX.length);
      const resolved = await this.resolve(bare, importer, { skipSelf: true });
      if (!resolved) return null;
      return MARK + resolved.id;
    },

    load(id) {
      if (!id.startsWith(MARK)) return null;
      const file = id.slice(MARK.length);
      // readFileSync rather than an inlined base64 blob: the compiler is a
      // few megabytes, and a literal that size in the module graph slows
      // every run down for no benefit.
      return [
        `import { readFileSync } from "node:fs";`,
        `export default new WebAssembly.Module(readFileSync(${JSON.stringify(file)}));`,
      ].join("\n");
    },
  };
}

export default defineConfig({
  plugins: [wasmModulePlugin()],
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
