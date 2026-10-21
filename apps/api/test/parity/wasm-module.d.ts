// Ambient type for the `?module` WASM import convention.
//
// apps/api's generated Prisma client loads its query compiler with
//
//     import("./query_compiler_fast_bg.wasm?module")
//
// `?module` is a Workers/Vite build convention meaning "give me a compiled
// WebAssembly.Module". TypeScript cannot resolve it on its own, and the
// parity harness asserts on that import directly (see
// harness-loads-offline.test.ts), so the shape is declared here rather than
// suppressed at the call site with an ignore comment.
//
// Types only — the runtime side is supplied by the loader plugin in
// vitest.parity.config.ts.

declare module "*.wasm?module" {
  const mod: WebAssembly.Module;
  export default mod;
}
