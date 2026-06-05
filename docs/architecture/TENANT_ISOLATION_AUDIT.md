# Tenant-isolation audit — Straumvakt (2026-06-05)

**Status:** Findings recorded for the **P4 hardening phase**
([GOING_PUBLIC_CRITICAL_PATH.md](./GOING_PUBLIC_CRITICAL_PATH.md)).
**Branch audited:** `feat/agreement-architecture`.
**Method:** read-only code audit across five enforcement layers — console
repositories (`src/lib`), driver API (`apps/api/src/routes/public/driver.ts`),
session→scope derivation, DB/RLS (`prisma/`), and the agreement resolver +
OCPP Authorize gate.

**The question this answers:** *is it actually wired so a driver sees only
their own data, a host only its own org, and the cross-host driver case is
handled — or is that only the design intent?*

---

## Executive summary

| Layer | Verdict | Severity |
|---|---|---|
| Driver sees only own data | ✅ Solid — token-derived identity, every query scoped | — |
| Cross-host driver (ADR 0026 §9) | ✅ Correct — union of own memberships, per-host slice | — |
| Host sees only own org | ⚠ Works today, **safe-by-accident** (not row-scoped) | **Medium** |
| DB / RLS backstop | ❌ None — isolation is 100% app-layer | **High** |
| Charging gate cross-host | ⚠ Correct but `enforceAuthorize` **default-OFF** | Operator decision |
| Agreement resolver / billing | ✅ scope-filtered; ⚠ workplace clause defaults org-wide | Low |
| OCPP ingest write-path | ❌ trusts envelope `orgId`, no row guard (perimeter-only) | **Medium** |

**One-line answer:** driver-only and cross-host-driver isolation is genuinely
enforced; host-only isolation *holds under today's threat model but for the
wrong reason*; there is no database backstop; the charging gate is off by
default.

---

## Findings

### A. Driver-side scoping — ✅ ENFORCED
Identity is the HMAC bearer token's `userId`, set from the DB row at login
(`apps/api/src/routes/public/driver.ts:154-158`), never from a param/body.
`requireDriver` verifies `sub==="driver"`, `kind==="access"`, expiry, presence
of `userId` (`lib/driver-session.ts:102-105`). Every data route filters by it:
- `sessions/current` → `where:{ userId, status:"in_progress" }` (`driver-sessions.ts:114`)
- `sessions/history` → `where:{ driverUserId: userId }` (`driver-sessions.ts:212`)
- `/me` → `findUnique({ where:{ id: userId } })` (`driver.ts:192`)
- `chargers` / `installations` → `driverGroupMembership.findMany({ where:{ userId, … } })`
- `start-session` / `stop-session` → connector/session looked up then **gated by
  a `userId`-scoped membership re-check** → 403/404 without leaking existence
  (`driver.ts:500-514`).

### B. Cross-host driver — ✅ CORRECT
A driver with `DriverGroupMembership` rows in 2+ host orgs gets the **union
across their own memberships** (`driver.ts:233-296`), bounded to installations
they belong to; history spans hosts but stays `driverUserId = you`. No path to
another driver, no path to a host they aren't a member of. Each session is
tied to exactly one host via `ChargeSession.org_id` (+ `session→installation→org`
FK chain), so per-host slicing is sound.

### C. Host/operator console scoping — ⚠ SAFE-BY-ACCIDENT  *(Medium)*
RBAC is real: `requirePermission(verb, {orgIdParam})`
(`apps/api/src/lib/auth/require-permission.ts:45-89`) with a deliberately
narrow `HOST_ADMIN_BUNDLE` (`permissions.ts:186-192`).
- **Routes WITH `orgIdParam` (~5 files):** org taken from path **but validated**
  by an active-Membership lookup `(userId, orgId)`
  (`effective-permissions.ts:43-54`) → ✅ enforced.
- **Routes WITHOUT `orgIdParam` (~40 files):** resources fetched **unscoped** —
  e.g. `getChargerById(db, id)` is a bare `findUnique` with **no `orgId`
  predicate** (`repositories/chargers.ts:191-196`, route `admin/chargers.ts:75`).
  A host_admin is blocked there only because, with no membership lookup, their
  per-tenant verbs resolve **empty → 403**. That is *safe-by-accident*, not
  row-scoping, and violates CLAUDE.md Rule 7 (repos must take `org_id` first).
- **❌ Bootstrap god-mode:** `isBootstrapSession` returns `next()`
  unconditionally (`require-permission.ts:55-58`) — full cross-org access.
  Intended for the single env-var platform operator, but it means RBAC/tenant
  isolation is largely **unexercised in production** today.

**Risk:** the day real per-tenant verbs are granted to multi-user host logins,
the ~40 unscoped routes become live cross-tenant leak surface.

### D. Database / RLS — ❌ NONE  *(High — no defense-in-depth)*
No Row-Level Security anywhere: zero `ENABLE ROW LEVEL SECURITY` /
`CREATE POLICY` / `current_setting` across all 33 migrations and both
`schema.prisma` files. The planned *"Sprint 9 RLS rebuild"*
(`prisma/schema.prisma:706-708`) never landed.
Tenant FK columns **are** consistent (`org_id` on organizations, sites,
installations, charging_stations, sessions, billing, tariff_definitions, …;
`driver_groups` via `owner_org_id`+`agreement_id`). `ChargeSession` carries a
direct non-null `org_id` plus the `session→installation→org` chain. So
isolation is *expressible* — but **enforced entirely by app-layer where-clauses**.
A single forgotten filter or raw query leaks across hosts with nothing at the
DB to catch it.

### E. Charging gate (cross-host) — ⚠ CORRECT BUT DEFAULT-OFF  *(operator decision)*
`apps/api/src/routes/internal/ocpp-authorize.ts:139-140`:
`enforceAuthorize = …installation?.enforceAuthorize ?? false`.
- **Flag OFF (platform default = shadow/accept-all):** a Host-A driver plugging
  in at Host B **with no membership → Accepted** (free-vend), unless the IdToken
  is `scopeInstallationId`-pinned.
- **Flag ON:** membership re-checked against the charger's `installationId`
  → no membership → **Blocked (`no_contract`)**, tested
  (`ocpp-authorize.test.ts:442-462`).

The enforcement logic is sound and default-deny on unknowns; it is simply
dormant until each operator opts in.

### F. Agreement resolver / billing — ✅ / ⚠  *(Low)*
`resolve.ts` is a pure, deterministic billing calculator, audience+scope
filtered (`resolve.ts:88-99`); the membership gate lives upstream in
`persist.ts` (`no_membership` denial, `persist.ts:188-211`). Installation
agreements + all bearer-rules are strictly host-scoped → no bleed.
⚠ **Workplace** agreement clause *defaults* are keyed on `cpoOrgId` (org-wide),
not per-installation (`persist.ts:167-186`, `types.ts:57-64`) — within one CPO
they apply to every installation a workplace driver-group touches. No
cross-CPO/cross-tenant leak; it's an ADR-0019 design question (Rule 5).

### G. OCPP ingest write-path — ❌ PERIMETER-ONLY  *(Medium)*
`src/lib/ocpp/projections.ts` updates tenant-scoped rows by client-supplied
`aggregateId` with **no `orgId` guard** and stamps new rows with `event.orgId`
verbatim (`projections.ts:181,217,231`). The only trust boundary is
`OCPP_INGEST_SECRET` on the ingest route — no defense-in-depth in the data
layer. A forged/buggy envelope claiming another org could mutate or mis-stamp
rows.

---

## P4 remediation checklist (priority order)

1. **[High] Org-scope the admin repositories (Rule 7).** Thread the caller's
   effective org scope from `requirePermission` into handlers; add `orgId` first
   arg + `where` predicate on the ~40 `orgIdParam`-less routes
   (`chargers`, `sites`, `users`, `billing`, …). Converts safe-by-accident →
   safe-by-construction. **← starting now (chargers as the template).**
2. **[High] RLS as defense-in-depth.** `ENABLE ROW LEVEL SECURITY` +
   `org_id = current_setting('app.current_org')::uuid` policies on tenant
   tables; Neon adapter sets the GUC per request. Columns already exist.
   (Rule 3/4 — migration; careful rollout.)
3. **[Medium] Guard the projection write-path.** Verify `aggregateId` belongs
   to `event.orgId` before mutating (`projections.ts`).
4. **[Medium] Retire / fence the bootstrap god-mode** once userId-bearing
   sessions are universal; add an explicit platform-scope rather than a blanket
   bypass.
5. **[Operator] Decide the `enforceAuthorize` rollout** — cross-host charging is
   open until each installation opts in (Rule 5 — billing/access).
6. **[Low] Confirm workplace clause-default breadth** (per-CPO vs per-installation)
   with the operator (ADR-0019).
7. **Remove the dead `requireOrg` primitive** in `src/lib/repositories/_context.ts`
   (no production callers) or wire repos through it, so it doesn't read as
   enforcement that isn't there.

## Tenant-isolation test gaps (for P4 tests)
- Multi-host driver: assert Host A queries never return the driver's Host B
  sessions/invoices/access.
- Host_admin (non-bootstrap, userId-bearing) hitting `orgIdParam`-less routes:
  assert row-level denial, not just empty-perm 403.
- Authorize gate ON: cross-host reject (already covered); add OFF-mode coverage
  documenting the free-vend window.
