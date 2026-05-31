# Code Security Audit — 2026-05-31 (AUD-2)

Scope: `apps/api/src/`, `src/`, `middleware.ts`.
Auditor: Claude Sonnet 4.6 (background agent).
Companion: AUD-1 audits the DB side.

---

## Category 1: API Route Auth Coverage

### Pattern recap

All admin routes share this layered gate pattern:

1. Router-level `adminBilling.use("*", requireAdmin)` — validates the HMAC
   session cookie; returns 401 if absent or invalid.
2. Per-route `requirePermission("billing.read|write")` — checks the caller's
   effective permission set against the DB; returns 403 if lacking.

Internal routes use `verifyIngest(c.req.raw, c.env.OCPP_INGEST_SECRET)` —
constant-time shared-secret comparison from `lib/ocpp-internal-auth.ts`.

Webhook routes use a Bearer-token comparison in a `use("*", ...)` middleware
that wraps the entire `zaptecWebhooks` router.

### Findings

**FAIL — billing.ts line 176: `GET /tariffs` missing `requirePermission`**

`apps/api/src/routes/admin/billing.ts:176`

```ts
adminBilling.get("/tariffs", async (c) => {
```

The route is covered by `adminBilling.use("*", requireAdmin)` so unauthenticated
callers are rejected. However every other billing read-endpoint in the same file
(lines 86, 101, 113) adds `requirePermission("billing.read")` as an explicit
per-route gate. This one does not. A session holder with no billing.read grant
can read the entire `TariffDefinition` catalogue (names, vatRatePct, org
attachments, computeRuleKind, pricePerKwhMinor). On the current codebase that
only affects multi-user sessions; the bootstrap admin gets god-mode regardless.
But when Sprint 5's real multi-user sessions roll out to org-scoped agents this
route will be the only billing endpoint that doesn't enforce `billing.read`.

**Fix:** Add `requirePermission("billing.read")` as the second argument:

```ts
adminBilling.get("/tariffs", requirePermission("billing.read"), async (c) => {
```

---

**WARN — agreements-debug.ts: `POST /debug-resolve` and `GET /debug-options` lack `requirePermission`**

`apps/api/src/routes/admin/agreements-debug.ts:81` and `:165`

Both routes use only `requireAdmin` (via the router-level `use("*", requireAdmin)`).
`POST /debug-resolve` runs `resolveBillingLines()` against real session data,
surfaces agreement clause details, billing-line amounts, and CPO org IDs. No
write occurs. `GET /debug-options` enumerates all driver users and all charging
stations (up to 500 each).

These are operator-only debug tools. The current bootstrap-admin-only real-world
user means no practical exposure today. Once org-scoped agents log in, however,
any authenticated session can enumerate the full driver/charger list and run
billing-resolution probes against arbitrary (userId, chargingStationId) pairs
without holding `billing.read`.

**Recommendation:** Gate both endpoints with `requirePermission("billing.read")`.
No blocking concern for the current sprint, but file before multi-user rollout.

---

**WARN — agreements-resolve.ts: `POST /:sessionId/resolve` lacks `requirePermission`**

`apps/api/src/routes/admin/agreements-resolve.ts:26`

Gated by `requireAdmin` only. This endpoint writes `agreements.billing_lines`
to the DB. It is the only billing-write surface without a `billing.write` gate.
Rationale in the file is that it's an "operator testing / backfill" endpoint.
Under the bootstrap-admin model that's fine. Under a multi-user model any
`admin`-role session could trigger billing-line writes for arbitrary sessions.

**Recommendation:** Add `requirePermission("billing.write")`.

---

**PASS — all Phase 1 billing CRUD (billing-cost-factors, billing-tariff-mgmt, billing-rate-references)**

Every write endpoint (POST, PATCH, `/deactivate`, `/reactivate`, `/publish`,
`/retire`) carries `requirePermission("billing.write")`. Every read endpoint
carries `requirePermission("billing.read")`. The parent `adminBilling` router
applies `requireAdmin` at the `use("*")` level; the sub-routers inherit it.

---

**PASS — all other admin routes (orgs, sites, installations, circuits, chargers,
users, memberships, contracts, properties, groups, idTokens, orgInvites,
vendorCredentials, zaptec, onboarding, activeSession, vehicles, me)**

Exhaustive check via grep confirms: every route file applies `router.use("*",
requireAdmin)` at the top, and every write endpoint carries a matching
`requirePermission(verb)`.

---

**PASS — internal routes (`ocpp-auth`, `ocpp-authorize`, `ocpp-events`,
`pending-discovery`, `zaptec-trigger-sync`, `zaptec-state-event`)**

All six internal POST handlers call `verifyIngest()` as their first action
before any business logic. `verifyIngest` does a constant-time comparison of the
`Authorization` header value against `env.OCPP_INGEST_SECRET` and returns a 401
Response on mismatch.

---

**PASS — webhook routes (`zaptec`)**

`zaptecWebhooks.use("*", ...)` middleware runs before all three webhook handlers.
It checks `ZAPTEC_WEBHOOK_SECRET`. When the secret is unset it returns 503 rather
than fail-open, which is the correct default.

**WARN — diagnostic fail-open mode in `zaptec.ts`**

`apps/api/src/routes/webhooks/zaptec.ts:38-58`

When `ZAPTEC_WEBHOOK_DIAGNOSTIC` is set to `"1"` or `"true"`, the middleware
logs all request headers (including the `Authorization` header) and calls
`next()` unconditionally without validating the Bearer secret. In that mode the
`/auth` handler also returns `Accept` for every RFID tap regardless of token
state. This was intentional (retro 2026-05-04) and the code comments document
that the operator must unset the flag after initial configuration.

The risk: if `ZAPTEC_WEBHOOK_DIAGNOSTIC` is left set in production, any
unauthenticated caller can trigger session-start/session-end writes and RFID
Accept responses. The code itself logs a `[zaptec-webhook] DIAGNOSTIC fail-open`
warning on every request, which is the intended operator signal.

**Recommendation:** Add a startup assertion (or a cron health-check alert) that
logs a high-severity warning when `ZAPTEC_WEBHOOK_DIAGNOSTIC` is set in the
production environment. This is a configuration hygiene item, not a code bug.

---

## Category 2: Hardcoded Secret / Connection-String Leakage

### Findings

**PASS — no connection strings with credentials in tracked source**

Grep for `postgres(ql)?://[^'"$\s]*:[^'"$\s]*@` across all tracked `.ts` files
returned zero matches.

---

**PASS — no JWT tokens hardcoded**

Grep for `eyJ[A-Za-z0-9+/]{20,}` returned only matches inside
`package-lock.json` integrity hashes (SHA-512 npm checksums) — not JWTs.

---

**PASS — no Stripe-like API keys (`sk_live_`, `sk_test_`)**

Zero matches across the entire repo.

---

**PASS — no Bearer tokens hardcoded in source**

Grep for `Bearer [A-Za-z0-9\-_\.]{20,}` in `apps/api/src` returned zero
matches. Bearer tokens in the codebase are read from `c.env.*` bindings at
runtime.

---

**PASS — secret environment variables accessed correctly**

All known secrets (`AUTH_SECRET`, `OCPP_INGEST_SECRET`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `DATABASE_URL`, `ZAPTEC_WEBHOOK_SECRET`, `OCPP_CRED_KEK`)
are accessed via `c.env.X` (API Worker) or `process.env.X` (UI Worker / Next.js
edge) with no hardcoding. The `src/lib/admin-session.ts` UI-Worker copy reads
from `process.env` and guards with a length check before proceeding. None appear
in `wrangler.jsonc` `vars` blocks.

---

## Category 3: `as any` / `as unknown as` Bypasses in Critical Paths

### Scope reviewed

- `apps/api/src/lib/tariff/*`
- `apps/api/src/lib/agreement/*`
- `apps/api/src/lib/auth/*`
- `apps/api/src/lib/admin-session.ts`
- `middleware.ts`
- `apps/api/src/routes/admin/billing*.ts`
- `apps/api/src/lib/password.ts`
- `apps/api/src/lib/ocpp/events-repository.ts`

### Findings

**PASS — `lib/tariff/*`**

No `as any` or `as unknown as` found in `compute-session-cost.ts` or
`resolve-tariff-chain.ts`.

---

**PASS — `lib/auth/*`**

`require-permission.ts:162`: `(session as SessionPayload & { userId?: string }).userId`
— This is a forward-compat cast for the pre-Sprint-5.5 session shape. The outer
type is constrained; the cast adds a nullable field, not removes type safety.
PASS.

`require-permission.test.ts:21` and `:167`: test-only `as any` / `as unknown as`
stubs. Not production paths.

---

**PASS — `lib/admin-session.ts` (both copies)**

No type bypasses found in either the API Worker or UI Worker copies.

---

**PASS — `middleware.ts`**

No type bypasses.

---

**WARN — `lib/password.ts:55`: `salt as unknown as ArrayBuffer`**

```ts
salt: salt as unknown as ArrayBuffer,
```

This is a WebCrypto API quirk: the standard types declare `salt` as
`BufferSource` but the Workers runtime's type stubs declare it as
`ArrayBuffer`. Casting `Uint8Array` to `ArrayBuffer` via `unknown` is
technically incorrect (they are different types) but works because the
runtime accepts `BufferSource` at the wire level. The function is used
only in the PBKDF2 password verifier; no user-controlled data flows
through the type bypass itself — the bypass is on the salt (random bytes)
not on the password or hash.

**Recommendation:** Prefer `salt.buffer as ArrayBuffer` (the underlying
buffer of the Uint8Array) to make the cast structurally correct.
Low severity.

---

**PASS — `lib/agreement/persist.ts:399`**

```ts
computationDetail: l.computationDetail as unknown as object,
```

This casts a `Record<string, unknown>` (typed result from resolver) to Prisma's
expected `object` type for a `Json` column. The data at this point has already
been validated by the resolver's type system. No user input flows through this
cast.

---

**PASS — `lib/ocpp/events-repository.ts:110, 144`**

Line 110: Casts the idempotency-key `result` JSON field (stored as `JsonValue`)
back to `IngestResult`. The field was written by the same code in the same
function; the round-trip is safe.

Line 144: Casts `IngestResult` to `Prisma.InputJsonValue` for the `result`
column write. Prisma requires this adapter cast for `Json` fields; the data
is a well-typed struct at the call site.

---

**PASS — `lib/billing/zod-common.ts:100, 111`**

`PILOT_AGREEMENT_TYPES as unknown as [string, ...string[]]` and
`PILOT_FACTOR_CODES as unknown as [string, ...string[]]` — zod's `z.enum()`
requires a non-empty tuple type; TypeScript infers a plain `string[]` from the
const arrays. The cast is the standard idiom for this pattern and does not bypass
any runtime validation; zod still validates the values at parse time.

---

**PASS — `routes/webhooks/zaptec.ts:214, 338`**

`raw as unknown as Prisma.InputJsonValue` — stores the parsed webhook body
(already a `Record<string, unknown>`) into a `Json` Prisma column. Same pattern
as above; required by Prisma's adapter type.

---

**NOTE — Test files**

Multiple `as any` and `as unknown as PrismaClient` casts in `*.test.ts` files
are standard mock-object patterns. These are not production paths and are
excluded from the FAIL/WARN assessment.

---

## Category 4: Raw SQL / String-Interpolated SQL

### Scope

`apps/api/src/` (excluding `scripts/`).

### Findings

**PASS — `lib/db/raw.ts` uses parameterized queries throughout**

`batchInsertEventLog`, `findExistingIdempotencyKeys`, `batchInsertIdempotencyKeys`,
and `batchIngestHeartbeats` all build their SQL strings with `$1`, `$2`, ...
placeholders. Column names are assembled from the `EVENT_LOG_COLUMNS` and
`IDEMPOTENCY_KEY_COLUMNS` const maps — these are compile-time-known identifiers,
not user input.

The one non-parameterized string construction is the tuple placeholder list
(e.g. `($1, $2, $3)`), which is generated by counting `events.length` and
`inserts.length` at call time. No user-controlled string reaches any part of the
SQL template.

---

**PASS — `lib/db/partition-cron.ts`**

Partition-cron DDL uses template literals to construct table names from
year/month integers derived from `new Date()` (system clock). No user input
reaches these strings.

---

**PASS — `$executeRaw` / `$executeRawUnsafe` / `$queryRawUnsafe`**

Grep across all of `apps/api/src/` returned zero matches. The codebase uses
Prisma's typed ORM API exclusively for DB queries except for the explicit
`pg.Pool` raw path in `lib/db/raw.ts`, which is parameterized throughout.

---

## Category 5: Repository + Mapper Pattern Adherence (Rule 7)

### Findings

**PASS — `apps/api/src/routes/` imports no Prisma types directly**

Grep for `from '@prisma/client'` and `from "../generated/prisma/client"` across
all route files found only:

- `apps/api/src/routes/webhooks/zaptec.ts:34`:
  `import type { Prisma, PrismaClient } from "../../generated/prisma/client";`

This import is `type`-only and used exclusively for the `Prisma.InputJsonValue`
type cast on `rawPayload` (a JSON column write). The `PrismaClient` import is
used only in the type annotation for `Prisma.TransactionClient` parameters of
two helper functions (`placeSyntheticSession`, `resolveDriver`). No runtime
Prisma client is instantiated in a route file. The rule's intent ("pages and API
routes do not use Prisma types directly") is technically stretched here: the
route file does use `Prisma.InputJsonValue` and `Prisma.TransactionClient`
directly instead of a mapper abstraction. The business logic (session creation,
ledger upsert) is also inline in the route file rather than in a repository.

**WARN — `routes/webhooks/zaptec.ts` contains inlined business logic**

The session-start, session-end, and `placeSyntheticSession` helper functions
contain ~200 lines of Prisma ORM calls inline in the route file. This violates
the spirit of Rule 7 (repository pattern). The logic is correct and tested, but
future changes to the session-placement algorithm (e.g. adding a new connector
lookup strategy) would require editing the route file directly.

**Recommendation:** Extract `placeSyntheticSession`, `resolveDriver`, and the
session upsert logic into `repositories/zaptec-webhook-session.ts` with typed
return values. The route handlers would then be thin wrappers. Not a security
issue; a maintainability issue that increases surface for logic bugs in a
billing-critical path.

---

**PASS — `src/app/(app)/` pages contain no Prisma imports**

Grep for `from '@prisma/client'`, `from "straumvakt-prisma-cf-client"`, and
`PrismaClient` across all `src/app` `.tsx` files returned zero matches in
page/layout components. All DB access in the UI Worker goes through
`src/lib/repositories/` per Rule 7.

---

## Category 6: Session Integrity / CORS / Rate Limiting

### Findings

**PASS — CORS locked to known origins for admin routes**

`apps/api/src/index.ts:83-97`:

```ts
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://hlada-staging.straumvakt.workers.dev",
  "https://hlada.straumvakt.workers.dev",
];
app.use(
  "/api/*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
    ...
  }),
);
```

The origin callback returns `null` for unlisted origins, which hono/cors
translates to omitting the `Access-Control-Allow-Origin` header — browsers block
cross-origin credentialed requests to those origins. The allowlist covers dev,
staging, and production correctly.

---

**WARN — driver API CORS is `origin: "*"`**

`apps/api/src/routes/public/driver.ts:47-55`:

```ts
publicDriver.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);
```

The in-code comment acknowledges this is a pilot allowance and should be locked
to the Flutter web build domain when published. For native iOS/Android clients
CORS does not apply (no browser enforcement), but any web-hosted page can make
credentialed requests to the driver endpoints from any origin.

The driver API uses Bearer tokens (not cookies), so `credentials: true` is not
set — there is no session-cookie leak risk. The worst-case from `"*"` CORS is
that a malicious web page can call the `/api/driver/login` endpoint from any
origin (essentially a cross-origin password-check surface). That is acceptable
for a pilot but should be tightened before public launch.

**Recommendation:** Set `origin` to the published Flutter web domain (or the
API's own origin as the fallback) before going beyond pilot. Track this in the
Sprint 9 / Sprint 10 delivery plan.

---

**FAIL — No rate limiting on the login endpoint**

`apps/api/src/routes/admin/auth.ts` and `apps/api/src/routes/public/driver.ts`

Neither `POST /api/admin/login` nor `POST /api/driver/login` has any rate
limiting. Both endpoints compare passwords (one via `timingSafeEqualText`,
the other via PBKDF2 `verifyPassword` which is compute-expensive). The expensive
PBKDF2 comparison naturally throttles brute-force attempts per CPU budget, but:

- The admin login falls through to a constant-time string comparison for the
  bootstrap admin path (`timingSafeEqualText`) which is extremely fast.
- There is no lockout or exponential back-off on repeated failures.
- Cloudflare Workers have no built-in rate-limiting middleware in this stack.

Cloudflare's WAF/Rate Limiting rules can be applied at the network layer without
code changes. Alternatively, Hono has a `@hono/rate-limiter` helper that works
with Cloudflare Workers KV.

**Recommendation:** Apply a Cloudflare WAF Rate Limiting rule to
`/api/admin/login` and `/api/driver/login` (e.g. max 10 attempts / 60 s per IP).
For the driver login additionally add a `verifyPassword` call even on the
"user not found" path to equalise CPU cost (this is already done for the admin
path — the driver path should match).

---

**PASS — Session cookie attributes**

`apps/api/src/routes/admin/auth.ts:113-120`:

```ts
setCookie(c, adminSessionConfig.SESSION_COOKIE_NAME, token, {
  path: "/",
  httpOnly: true,
  secure: !isLocal,
  sameSite: isLocal ? "Lax" : "None",
  domain: isLocal ? undefined : "straumvakt.workers.dev",
  maxAge: adminSessionConfig.SESSION_TTL_SECONDS,
});
```

- `httpOnly: true` — XSS cannot read the cookie. PASS.
- `secure: true` in production — cookie not sent over plain HTTP. PASS.
- `sameSite: "None"` in production — required because the UI and API are on
  different subdomains (cross-origin credentialed fetch). Combined with `secure`
  this is the correct configuration for cross-origin cookie sharing.
- `domain: "straumvakt.workers.dev"` — scoped to the operator's domain, not
  broader. PASS.
- TTL 12 hours — reasonable for an operator console session.

---

**PASS — No login via GET**

Grep for `GET` handlers on `/login` or `/auth` routes returned none. Both login
endpoints use `POST`.

---

**PASS — Admin session HMAC is timing-safe**

`verifyAdminSession` in both `apps/api/src/lib/admin-session.ts` and
`src/lib/admin-session.ts` uses a handwritten `timingSafeEqualBytes` function
that XORs all bytes and checks the final accumulator — no early exit on mismatch.
The PBKDF2 password verifier also uses the same byte-comparison utility.

---

**PASS — `middleware.ts` strips spoofed headers before auth check**

Lines 40-41 delete any client-supplied `x-straumvakt-admin-verified` header
before the HMAC verify runs, preventing header-injection bypasses.

---

## Headline

```
CRITICAL findings:  0
WARN findings:      6
FAIL findings:      2
PASS categories:    mixed (no category fully failed; 2 FAILs and 6 WARNs spread across cats 1, 3, 5, 6)
```

### FAILs (require fix before multi-user rollout)

1. **`billing.ts:176` — `GET /tariffs` missing `requirePermission("billing.read")`**
   File: `apps/api/src/routes/admin/billing.ts`
   Fix: add `requirePermission("billing.read")` as second arg to the `.get()` call.

2. **No rate limiting on login endpoints**
   Files: `apps/api/src/routes/admin/auth.ts`, `apps/api/src/routes/public/driver.ts`
   Fix: Cloudflare WAF rate-limiting rule on `/api/admin/login` and `/api/driver/login`;
   consider Hono `@hono/rate-limiter` for in-process defense.

### WARNs (fix before multi-user org-agent rollout)

1. **`agreements-debug.ts` `POST /debug-resolve` and `GET /debug-options` missing `requirePermission`** (cat 1)
2. **`agreements-resolve.ts` `POST /:sessionId/resolve` missing `requirePermission("billing.write")`** (cat 1)
3. **`ZAPTEC_WEBHOOK_DIAGNOSTIC` fail-open mode has no production safety net** (cat 1)
4. **`lib/password.ts:55` structurally-incorrect `Uint8Array → ArrayBuffer` cast** (cat 3)
5. **`routes/webhooks/zaptec.ts` business logic inlined in route (Rule 7 spirit violation)** (cat 5)
6. **Driver API CORS `origin: "*"` — acceptable for pilot, must be tightened before public launch** (cat 6)
