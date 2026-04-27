# Staging deploy — deferred

**Date:** 2026-04-27
**Branch:** `dev/sprint-01-ui-detour`
**Status of work:** local fully functional; staging deploy pipeline blocked by Prisma 7 + Cloudflare Workers WASM incompatibility.

## What got done

- Cloudflare Workers Git integration wired on `hlada-staging` (was on `hlada` prod by mistake; disconnected from prod, connected to staging).
- `package-lock.json` removed from repo (Windows-generated locks were referentially incomplete under Cloudflare's Linux `npm ci`; falling back to `npm install` resolves cross-platform deps cleanly).
- `DATABASE_URL` + `DIRECT_URL` secrets set on `hlada-staging` Worker pointing at staging Neon (`ep-quiet-bird-abxartp8-pooler` / branch `br-tiny-river-abgpqq37`).
- Build settings: Build = `npm run deploy:staging`, Deploy = `echo "deploy in build"`. Build + deploy happen in one shell so build artifacts (`.open-next/worker.js`) survive.
- Build pipeline currently produces a successful deploy.

## What's broken on staging

After login, the dashboard loads. **Every page that hits Prisma → Neon throws a runtime WASM error**:

```
(error) CompileError: WebAssembly.Module():
  Wasm code generation disallowed by embedder
```

(Captured via `npx wrangler tail hlada-staging`.)

Pages that work:
- `/dashboard` (no DB)
- `/reference/*` (filesystem reads)

Pages that error:
- `/sites`, `/installations`, `/circuits`, `/chargers` (Operations group — Prisma queries)
- `/tenants/organizations`, `/tenants/properties`, `/people/users` (Tenants — Prisma queries)
- `/billing/cost-centers`, `/billing/contracts`, `/billing/driver-contracts`, `/billing/tariffs` (Billing — Prisma queries)
- `/billing/dso`, `/billing/electricity` (work — only filesystem reads, no Prisma)
- `/onboard` (Prisma list of orgs)

## Root cause

Prisma 7 ships a WASM-based query compiler (`query_compiler_fast_bg.<dialect>.wasm-base64.js` in `@prisma/client/runtime/`). The compiler is base64-encoded WASM that gets decoded and compiled at runtime via `WebAssembly.Module(buffer)`. Cloudflare Workers' default security policy disallows runtime WASM compilation — only static imports are allowed.

The generated `@prisma/client/edge.js` for our Cloudflare-targeted bundle contains:

```js
getQueryCompilerWasmModule: async () => {
  const loader = (await import('#wasm-compiler-loader')).default
  const compiler = (await loader).default
  return compiler
}
```

This dynamic import + compile path is what the embedder rejects.

## Failed attempts

- `prisma generate --no-engine` — flag was removed in Prisma 7 (was Prisma 5/6).
- `engineType = "client"` in schema.prisma generator — generated `edge.js` still contained the `getQueryCompilerWasmModule` runtime loader. (Reverted; untested whether the loader is actually called when `engineType = "client"` is set.)
- `previewFeatures = ["driverAdapters"]` — `driverAdapters` is GA in Prisma 7, no-op.

## Paths forward

In rough order of effort and reward:

1. **Migrate to Prisma 7's new `prisma-client` generator** (different from `prisma-client-js`). Has explicit `runtime = "cloudflare"` option that bundles WASM as a static import (Cloudflare permits) instead of runtime compilation. Requires updating import paths across the codebase.

2. **Downgrade to Prisma 6.x.** Pre-WASM-compiler era; the binary engine was used and could be excluded with `--no-engine`. Loses some Prisma 7 features.

3. **Replace Prisma with Drizzle** for runtime queries. Drizzle is Cloudflare-Workers-native. Repository pattern stays, the engine swaps. Larger refactor.

4. **Keep Prisma but execute queries via raw SQL** through `@neondatabase/serverless` directly. Bypasses the Prisma client entirely on the server. Loses ORM ergonomics.

5. **Wait for Prisma to ship Workers-friendly bundling.** Track https://github.com/prisma/prisma issues. Punt staging until then.

## Recommendation

**Option 1 (migrate to `prisma-client` generator).** Smallest blast radius, keeps Prisma. Roughly:
- Update `schema.prisma` generator to `provider = "prisma-client"` with `runtime = "cloudflare"` and `output = "../node_modules/.prisma-client"`.
- Update import paths (`@prisma/client` → `.prisma-client` or wherever the new output lands).
- Run `npx prisma generate`.
- Re-deploy and verify Workers can load it.

Estimated effort: 1-2 hours when undertaken with attention.

## Local state

`http://localhost:3000` is fully functional with all Sprint 2 architecture work. All operator validation should happen there until staging is fixed.

## Branch state at deferral

- `dev/sprint-01-ui-detour` HEAD: see `git log -1`
- `staging` HEAD: same as dev (fast-forwarded)
- Last successful Cloudflare build: commit `3cd506e` — code on staging Worker has WASM runtime errors but routes serve.

## Don't reuse this without

- A Linux-or-WSL development environment (Windows lock files break Cloudflare's `npm ci`).
- A Cloudflare Workers Paid plan if needed for memory limits during WASM compilation (uncertain; verify if downgrading the Prisma version is rejected).
- Tagged rollback anchors before any prod migration:
  - `pre-host-drop-2026-04-26`
  - `pre-org-enrichment-2026-04-26`
  - `pre-control-plane-optionality-2026-04-26`

(None exist on `origin` yet — see `docs/notes/2026-04-26-post-rev5-actions.md` P1.2.)
