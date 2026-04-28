# ADR 0013 — Five-Tier Topology: Pages (UI) + Workers (API) + Durable Objects (OCPP) + Queues + Neon

**Status:** Proposed
**Date:** 2026-04-28
**Sprint:** documentation lands immediately; migration is a multi-sprint effort (Sprint 3+). Sprint 2 work continues on the existing monolithic Next.js Worker until cutover.
**Supersedes (in part):** [ADR 0004](./0004-ocpp-transport-service-binding.md) deployment topology assumptions. Native OCPP transport choice (service binding vs hostname routing) is unchanged.
**Relates to:** [ADR 0011](./0011-control-plane-optionality.md), [ADR 0012](./0012-protocol-neutral-physical-model.md) — protocol-neutral data model is unaffected; only the runtime split changes.

## Context

The Sprint 2 deploy push exposed a structural problem with the current topology. Today the application is a single Next.js 16 app deployed via OpenNext to one Cloudflare Worker (`hlada` in production, `hlada-staging`). The Next.js bundler (Turbopack or webpack) sits between source code and Wrangler's worker bundling, and it does not handle Prisma 7's Cloudflare-targeted client cleanly:

- Turbopack rewrites `import "./query_compiler_fast_bg.wasm?module"` to runtime helpers that call `WebAssembly.compileStreaming` — **not exposed in workerd**.
- Webpack with `experiments.asyncWebAssembly: true` emits the WASM under `static/wasm/<hash>.wasm` and at runtime reads it via `fs.readAll('/bundle/static/wasm/<hash>.wasm')` — **OpenNext does not place that file at the path the runtime expects**, so every Prisma query 500s.
- The half-fix attempt at externalizing the generated client via `serverExternalPackages` failed because Next.js's "collect page data" pass uses Node.js to import server modules and chokes on TypeScript files (Prisma 7's generator emits `.ts`).

The core issue is that **Prisma 7's WASM-based query compiler expects a Wrangler/esbuild-style bundler**, not Next.js's bundlers. Every workaround so far has been an attempt to make Next.js's bundler behave like Wrangler's. The right fix is to take Prisma out of Next.js's bundle entirely.

The current topology also conflates UI delivery, API logic, OCPP charger state, and async job execution into one Worker. That conflation isn't required by the domain. Cloudflare offers purpose-built primitives for each:

- **Pages** is optimized for static UI delivery with edge caching.
- **Workers** are optimized for stateless request handling.
- **Durable Objects** are optimized for stateful, single-instance entities (perfect for OCPP charger sessions — each charger is an instance with a long-lived WebSocket and per-charger state).
- **Queues** are optimized for async job dispatch and event fan-out (cost calculation, OCPP event projection, billing batch runs).
- **Neon** remains the system of record.

Aligning the runtime split with these primitives both fixes the Prisma bundler problem and gives each tier the right tool.

## Decision

Adopt a five-tier topology:

```text
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ Cloudflare Pages     │ ─► │ Cloudflare Workers   │ ─► │ Neon Postgres        │
│ — UI                 │    │ — API                │    │ — system of record   │
│   (operator console, │    │   (admin endpoints,  │    │   (multi-tenant      │
│    driver app shell) │    │    public endpoints, │    │    OLTP via Prisma 7 │
│                      │    │    OCPI, OCMF)       │    │    prisma-client     │
│                      │    │                      │    │    runtime cloudflare)│
└──────────────────────┘    └──────────┬───────────┘    └──────────────────────┘
                                       │
                            ┌──────────┼──────────┐
                            ▼          ▼          ▼
                    ┌──────────────┐ ┌────────┐ ┌──────────────────┐
                    │ Durable      │ │ Queues │ │ Service binding  │
                    │ Objects      │ │ — async│ │ to OCPP gateway  │
                    │ — one DO per │ │   jobs │ │   (existing      │
                    │   charging   │ │   batch│ │   straumvakt-ocpp│
                    │   station    │ │   events│ │   stays as-is)  │
                    │ (OCPP state, │ │        │ │                  │
                    │  WebSocket)  │ │        │ │                  │
                    └──────────────┘ └────────┘ └──────────────────┘
```

### Tier responsibilities

**Pages — UI.** Operator console (current `src/app/(app)/*` routes) and driver app shell. Delivers HTML/CSS/JS; no direct database access; talks to the API Worker for all data. Edge-cached where possible. Auth state held in cookies issued by the API Worker.

**Workers — API.** Stateless request handlers for `/api/admin/*`, `/api/public/*`, OCPI and OCMF endpoints. Bundled by Wrangler+esbuild — no Next.js between source and worker. Imports Prisma 7 client (with `runtime: "cloudflare"`) directly; WASM static-import works natively. Holds the admin HMAC session logic and tenant-scoped repository layer.

**Durable Objects — OCPP charger state.** One DO instance per charging station. Holds the OCPP WebSocket connection, transient session state, command queue, and last-seen heartbeat. Persistence to Neon happens via the API Worker (DOs do not talk to Neon directly; they enqueue via Queues for projection writes). Replaces the role of the existing `straumvakt-ocpp` worker's per-charger handling — the existing worker continues to terminate native OCPP TLS and forward to DOs via service binding (ADR 0004 unchanged).

**Queues — async jobs and events.** Cost calculation, OCPP event projection, CDR translation, billing batch runs, issue routing. DO publishes events; API Worker consumes and projects to Neon. Future Kafka migration (per operator note) replaces or supplements Queues; design the consumer interface so the swap is mechanical.

**Neon — system of record.** Unchanged. All operational, billing, audit data. Accessed only by the API Worker via Prisma 7 with the Neon driver adapter (`@prisma/adapter-neon`). DOs never connect directly.

### What each tier does *not* do

- Pages does not query Neon.
- API Worker does not hold long-lived state beyond per-request scope. No singletons, no in-memory caches that cross requests.
- Durable Objects do not query Neon directly. All persistence is request-projected via Queues → API Worker → Prisma → Neon. This keeps the DO's hot path predictable and avoids adapter/connection-per-DO problems.
- Queues are not a request/response channel. Anything that needs a synchronous answer goes through the API Worker.

## Why this fixes the Prisma WASM problem

The API Worker is built by Wrangler directly (`wrangler deploy`), not via Next.js → OpenNext. Wrangler/esbuild understands `import "./*.wasm?module"` natively as a static workerd module import. The compileStreaming/instantiateStreaming/runtime-fs-read failure modes we hit on the Next.js bundle path do not exist on the bare-Workers bundle path.

Prisma 7's `prisma-client` generator with `runtime: "cloudflare"` is the documented configuration for exactly this case.

## Open questions (deferred to follow-up ADRs or operator decision)

1. **UI framework on Pages.** Next.js (Pages-compatible build via Pages Functions) or React+Vite SPA. Next.js inherits some of the bundler complexity we just fought; Vite SPA is simpler if SSR is not a hard requirement for the operator console. Driver app may have different SSR/SEO needs. Decision deferred until tier-1 cutover sketch.
2. **UI ↔ API auth.** HMAC-signed cookie passed through (extends current admin session model with the cookie scoped to a parent domain so Pages and Workers share it) or short-lived JWT exchange (Pages calls `/api/auth/exchange` to mint a JWT, stores in memory, attaches as `Authorization` header). HMAC cookie is simpler; JWT decouples Pages and Workers fully. Decision deferred.
3. **Durable Object → Queue → API Worker projection contract.** What event shape? At-least-once vs exactly-once? Idempotency keys? This deserves its own ADR once the API Worker is stood up and the projection requirements are concrete.
4. **OCPP gateway worker (`straumvakt-ocpp`) role.** Continue as the TLS termination + service binding entry point per ADR 0004, with DOs handling per-charger state inside its namespace? Or migrate the gateway logic into the API Worker's namespace and use DOs there directly? ADR 0004's service-binding pattern is architecturally clean; lean toward keeping it.
5. **Pages and Workers domain layout.** `straumvakt.is` for UI on Pages, `api.straumvakt.is` for the API Worker, `ocpp.straumvakt.is` for the OCPP gateway? Or keep the `*.straumvakt.workers.dev` pattern through pilot? Decision tied to operator branding readiness.

## Rollout plan (high level — sequenced over Sprints 3-4)

### Phase 1 — API Worker stood up alongside the monolith (no traffic cutover)

- New repo path: `apps/api/` (or split repo `straumvakt-api`). Plain Wrangler project. Imports `@prisma/client` (or the prisma-client generator output) with `runtime: "cloudflare"`. Hits staging Neon.
- Migrate one route end-to-end: `/api/admin/orgs` (list + create). Verify Prisma WASM works. Verify Neon connectivity. Verify the repository + mapper pattern from `src/lib/repositories/*` ports cleanly.
- API Worker deployed to `api-hlada-staging.straumvakt.workers.dev`. No production traffic yet.

### Phase 2 — Migrate all admin API routes

- Move every `src/app/api/admin/*/route.ts` handler into the API Worker. The existing repository layer (`src/lib/repositories/*`) goes with it — that code is already runtime-agnostic.
- Next.js admin pages start calling the new API Worker's URL via `fetch` (with credentials per the auth decision in question 2).
- Both deployments live concurrently; the monolith still serves UI from the old API endpoints, and one-by-one routes get pointed to the new Worker.

### Phase 3 — UI-only Pages deployment

- Strip server-side Next.js code from `src/app/api/*` (now lives in API Worker).
- Build for Pages target. Either Next.js Pages-compatible build OR migrate to Vite SPA (question 1).
- Pages deploys to `hlada-pages-staging.pages.dev` (or chosen domain). UI calls API Worker exclusively.
- Monolithic `hlada-staging` Worker becomes redundant.

### Phase 4 — Durable Objects + Queues for OCPP and async jobs

- DO namespace `ChargingStationDO` per ADR 0012's `assets.charging_stations` table. One DO instance per `charging_station_id`.
- OCPP gateway service-binds to API Worker, which dispatches into DO methods. DO publishes session/event payloads to a Queue.
- Queue consumer (in API Worker or separate consumer Worker) projects events into Neon via Prisma.
- Existing `straumvakt-ocpp` continues TLS termination and identity routing per ADR 0004.

### Phase 5 — Production cutover

- Once staging has run the new topology end-to-end for a sustained period (defined by Sprint 4 exit criterion), promote DNS/routes for production.
- Monolithic `hlada` Worker is decommissioned only after a confirmed-quiet period.
- Rollback path: keep `hlada` deployable from the old codebase tag for one full sprint after cutover.

## Consequences

### Positive

- Prisma 7 + Cloudflare Workers works without bundler gymnastics.
- Each tier scales independently and uses the runtime primitive Cloudflare optimizes for.
- Pages caches UI at the edge for free.
- Durable Objects make per-charger state explicit and removes the implicit "OCPP gateway holds the connection" coupling.
- Queues give us a clean seam for the future Kafka migration (consumer interface stays; transport changes).
- Removes a category of failure modes (Next.js bundler + Prisma WASM) that would otherwise keep recurring on every Next.js or Prisma minor upgrade.

### Negative / cost

- Multi-sprint refactor. Sprint 3 stands up the API Worker; Sprint 4 cutover. Sprint 2 work continues on the monolith until then.
- Cross-tier auth introduces a boundary that needs explicit design (open question 2). Today auth is a single Next.js middleware.
- Pages + Workers + DOs + Queues = four runtime surfaces to monitor. Observability needs to span them. Existing wrangler tail / observability binding works per Worker; need to define how aggregated logs land somewhere readable (Logpush + a sink, or paid Workers Logs).
- The repository + mapper pattern (Rule 7) is preserved but the call sites change. Pages components must use a new `apiClient` abstraction rather than direct repo imports. Some compile-time type safety is lost across the network boundary unless we share types via a generated SDK or a shared types package.

### Neutral

- The protocol-neutral physical model from ADR 0011 / ADR 0012 is unaffected — the data model lives in Neon and the API Worker speaks to it.
- The OCPP transport choice from ADR 0004 (service binding vs hostname routing for the gateway) is unaffected.
- The admin HMAC session model is preserved (just delivered across an HTTP boundary instead of within a single Next.js process — see question 2).

## Rollback

Each phase is reversible:
- Phase 1 → discard the API Worker; monolith continues serving.
- Phase 2 → flip individual routes back to the monolith handler.
- Phase 3 → redeploy monolith with UI; Pages deployment is removable.
- Phase 4 → DO traffic stops being projected; events drain from Queue; OCPP gateway falls back to direct projection.
- Phase 5 → redeploy old monolith from tagged commit; flip DNS.

## Decision date and author

Proposed 2026-04-28 by operator. Awaiting acceptance after Phase 1 is sketched and the open questions in this ADR have proposed answers.
