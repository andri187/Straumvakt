# Staging deploy — half-fixed, paused for daylight

**Date:** 2026-04-28 (~02:50 UTC, late-night session)
**Supersedes:** [2026-04-27-staging-deploy-deferred.md](./2026-04-27-staging-deploy-deferred.md)
**Status:** original WASM block fixed; new bundling-glue issue surfaces; reverting deferred.

## TL;DR

- Migrated Prisma 7 to the new `prisma-client` generator with `runtime = "cloudflare"`.
- Switched the build off Turbopack and onto webpack with `experiments.asyncWebAssembly`.
- The original `Wasm code generation disallowed by embedder` error is **gone**.
- A new error replaces it on every Prisma query:
  ```
  PrismaClientKnownRequestError: Invalid `prisma.X.findMany()` invocation:
  no such file or directory, readAll '/bundle/static/wasm/005dfb1334c418ea.wasm'
  ```
- Cause: webpack emits the WASM under `static/wasm/<hash>.wasm` and the worker calls `fs.readAll` on `/bundle/static/wasm/<hash>.wasm` at runtime, but OpenNext does not copy that directory into the deployed worker bundle.
- Staging left in this state. **No revert performed.** Sprint 2 UI work remains usable on local dev.

## What works after the half-fix

- Bundle audit (`grep -o 'WebAssembly.[A-Za-z]*' .open-next/server-functions/default/handler.mjs`):
  ```
  1 WebAssembly.Instance
  1 WebAssembly.instantiate
  ```
  No `compileStreaming`, no `instantiateStreaming`, no `new WebAssembly.Module()`. The only WASM APIs invoked are workerd-allowed.
- Login, dashboard, all `/reference/*` filesystem pages, all `_rsc=...` prefetches **return HTTP 200** with no error logs.
- Static asset paths and middleware work cleanly.

## What does not work

Every Prisma-backed page on staging — `/sites`, `/installations`, `/circuits`, `/chargers`, `/tenants/organizations`, `/tenants/properties`, `/people/users`, `/billing/*` — renders the Next.js error fallback. Tail logs show the file-not-found read against `/bundle/static/wasm/005dfb1334c418ea.wasm` for each query.

## Two unrelated regressions noticed during testing

1. **`/reference/electricity/dso` (and presumably `/billing/dso`, `/billing/electricity`)** — "Catalogue not found: docs/reference/iceland-energy-parties.json." The webpack/standalone build does not copy files from `docs/` into the worker bundle. Either move the JSON into `public/` or import it as a module instead of `fs.readFile`.
2. **`/reference/zaptec-api`** — "Assets not synced." Expected; `public/zaptec/openapi.json` is gitignored and only synced from `E:\Claude\zaptec-test`. Will always be missing on staging until that data lands in git or is served from a different source.

## Commits added this session (still on origin)

- `75cfeb3` — `[Sprint 2] Migrate to Prisma 7 prisma-client generator — fixes Cloudflare WASM block` (on `dev/prisma-client-generator` and merged into `staging`)
- `4aa0293` — `[Sprint 2] Switch build to webpack — fixes Cloudflare WASM compileStreaming` (on `staging` only)

Both commits represent **real progress** on the deploy-pipeline problem. Reverting is optional, not required — staging has been broken for days and one more night does not regress anyone.

## Paths forward (in rough effort order)

1. **Wrangler `wasm_modules` binding** — declare the WASM file in `wrangler.jsonc`:
   ```jsonc
   "wasm_modules": {
     "PRISMA_QUERY_COMPILER_WASM":
       "src/generated/prisma/internal/query_compiler_fast_bg.wasm"
   }
   ```
   Then patch the generated `class.ts` (or wrap it) to use `env.PRISMA_QUERY_COMPILER_WASM` instead of `import("./*.wasm?module")`. Most reliable. Brittle around `prisma generate` since the generated file gets overwritten — would need a postinstall patch script.

2. **Move the generated client into `node_modules`** so it can be marked `serverExternalPackages`:
   ```ts
   // schema.prisma
   output = "../node_modules/.prisma-cf-client"
   ```
   ```ts
   // next.config.mjs
   serverExternalPackages: [".prisma-cf-client"]
   ```
   Webpack stops processing the prisma client; OpenNext + Wrangler bundle it directly; Wrangler natively handles `?module` imports. Cleaner than option 1 if the resolution actually works through OpenNext.

3. **Custom esbuild plugin during OpenNext build** — replace webpack's WASM handling with a static-bundle pass keyed off `?module` query strings. Most engineering effort, most flexibility.

4. **Switch deployment target away from Cloudflare Workers** — Vercel, Render, Fly.io. Node-runtime deploy targets eat the Prisma 7 client without any of this gymnastics. Loses Worker-specific perks (DOs, KV, etc.) but unblocks shipping. The OCPP gateway worker can stay on Cloudflare independently.

## Branch state at pause

- `staging` HEAD: `4aa0293` (current Cloudflare-deployed code; broken on Prisma queries)
- `dev/prisma-client-generator` HEAD: `75cfeb3` (Prisma migration only, before the webpack switch)
- `dev/sprint-01-ui-detour` HEAD: `da453d4` (compact create forms, untouched by today's deploy work)
- Local dev fully functional; all operator validation should continue happening on `localhost:3000` until the bundling glue is sorted.

## Recommended next session

Pick option 2 (`serverExternalPackages` + `node_modules` output) for the first attempt — smallest blast radius, no generator-output patching. Budget 2 hours; if it does not pan out, fall back to option 1 (`wasm_modules` binding with a postinstall patch). Avoid option 3 unless options 1 and 2 both fail.

