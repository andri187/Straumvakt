# Domain and Worker cutover runbook

**Staged plan. No DNS, domain, Worker, binding or deploy action was performed.**
Every step is gated; none is executed here.

Covers Phase 4 (domains) and Phase 5 (Worker migration and CPMS retirement).

## Why `4fe0a95` is incomplete

`dev/rename-prod-worker` @ `4fe0a95` changes **one line**:

```diff
-  "name": "hlada",
+  "name": "straumvakt-console",
```

Root `name` only. `env.staging.name` (`hlada-staging`) is untouched.

**Three reasons it must not be deployed as an assumed in-place rename:**

1. **Wrangler cannot rename a Worker.** A script name *is* its identity. Verified
   against wrangler 4.84.1: the only `rename*` symbol in the bundle is
   `renameWorkerNamespace`, which acts on Workers-for-Platforms *dispatch
   namespaces*, not Worker scripts. Deploying creates a **new** Worker.
2. **It targets the Worker that isn't deployed.** `hlada` returns `error code:
   1042`. The name collision that matters is on **`hlada-staging`** — live, and
   serving `straumvakt.org`. The commit fixes the phantom and leaves the real one.
3. **A root deploy would create an empty Worker.** The root config has **no
   `HYPERDRIVE_DB` binding**, no secrets (they are per-Worker and never in
   config), no custom domains and no Git integration. `straumvakt-console` would
   come up with no database and no credentials.

Its instinct is right and its rationale is now verified — CPMS genuinely declares
both names. It is roughly **10% of the migration**, and the wrong 10% first.

## Migration risk ranking — the counter-intuitive part

| Worker | Bound *to* by | Owns | Rename risk |
|---|---|---|---|
| **web** `hlada-staging` | **nothing** | nothing | **lowest** |
| **API** `hlada-api-staging` | gateway (`MAIN_APP`) | queues, R2 | medium |
| **OCPP** `straumvakt-ocpp-staging` | web + API (`OCPP_GATEWAY`) | `IDENTITY_DO`, live charger WebSockets | **highest — field risk** |

The customer-facing Worker is the **safest** to move; the invisible one is the
dangerous one.

## OCPP-specific constraints

**Recommendation: do not rename the beta OCPP Worker at all.**

| Constraint | Consequence |
|---|---|
| Charger endpoint URL is device configuration | Changing it is a **field operation** across the fleet, not a control-plane one |
| Open WebSockets are long-lived | A cutover severs every connection at once |
| Severing all connections **is** a reconnect storm | Modelled at ~83 connects/s for 5k in a 60 s window |
| `IDENTITY_DO` holds per-charger state | A new Worker gets **new, empty** Durable Objects — state does not migrate |
| Transactions may be in flight | A session mid-charge whose gateway disappears cannot be stopped cleanly |
| OCPP credentials are per-charger | Re-provisioning is per-device |

If a production OCPP Worker is needed, **create `straumvakt-ocpp` fresh for
production chargers** — it is undeployed, so this costs nothing and touches no
field device. Beta chargers stay where they are.

---

# Runbook

## Stage 0 · Blocking verification (read-only)

Nothing proceeds until the [manual checklist](2026-08-09-hlada-staging-forensics.md#3--manual-verification-checklist--one-screen)
is complete. Minimum: account identity, **active version id** (the rollback
target — none exists today), Git-integration owner, custom-domain list,
Hyperdrive target, secret names, and **whether any CPMS Worker holds an
integration naming `hlada-staging`**.

**Stop condition:** integration owned by CPMS → incident, not a release step.

## Stage 1 · CPMS retirement (before anything else)

| # | Action | Type |
|---|---|---|
| 1.1 | Enumerate CPMS Workers and their Build settings | read-only |
| 1.2 | If any integration deploys `hlada`/`hlada-staging`, **disconnect it** | **MUTATION — approval** |
| 1.3 | Record CPMS's own deployed Workers and whether anything still depends on them | read-only |
| 1.4 | Decide CPMS's fate: retire, or repoint to names Straumvakt does not use | **decision** |

**Why first:** every later stage assumes only Straumvakt can deploy these
Workers. Until 1.2, that assumption is unverified, and a dormant repository can
undo any stage below with one push.

## Stage 2 · Give beta its own address (additive, no cutover)

| # | Action | Type |
|---|---|---|
| 2.1 | Add `beta.straumvakt.org` as a custom domain on the beta web Worker | **MUTATION — approval** |
| 2.2 | Add `api-beta.straumvakt.org` on the beta API Worker | **MUTATION — approval** |
| 2.3 | Verify TLS on both; confirm the brand domain still serves | verification |
| 2.4 | Update `NEXT_PUBLIC_API_BASE_URL` for beta and the mobile base URL **only after 2.3** | config |

**Additive by design.** The brand domain is untouched, so there is no
customer-visible moment. If it fails, detach and nothing was lost.

**Cookie scope, CORS, base URLs** — the constraints that make this non-trivial:

- The admin session cookie is host-aware: a `straumvakt.org` login sets a
  `.straumvakt.org` cookie (covers apex, `www`, and `api.`). Adding
  `beta.straumvakt.org` and `api-beta.straumvakt.org` **under the same parent**
  keeps that model working, and means a beta session cookie is scoped to the same
  parent as production. **Decide deliberately whether that is acceptable**; a
  `straumvakt-beta.org` style separate parent would isolate them completely at
  the cost of a second certificate and a second brand.
- The driver API uses **stateless bearer tokens, no cookies**, with explicit
  CORS allowing `Content-Type` and `Authorization`. Adding a beta origin means
  adding it to the allowed list.
- **The shipped mobile app pins `hlada-api-staging.straumvakt.workers.dev`
  directly.** Until a release moves it, that workers.dev hostname must stay
  alive. **Renaming the beta API Worker breaks every installed app** — so
  Stage 2.2 adds a domain, and the rename waits for a mobile release.

## Stage 3 · Build production, no traffic

| # | Action | Type |
|---|---|---|
| 3.1 | Add `HYPERDRIVE_DB` and any missing binding to the **root** config | config only |
| 3.2 | Create the production Neon project + branch; run migrations from scratch | **MUTATION — approval** |
| 3.3 | Create production Hyperdrive against it | **MUTATION — approval** |
| 3.4 | Deploy `straumvakt-web` / `straumvakt-api` — **workers.dev only, no custom domain** | **MUTATION — approval** |
| 3.5 | Set production secrets by name, from the same source of truth as beta's, **never copied through a terminal** | **MUTATION — approval** |
| 3.6 | Create `straumvakt-ocpp` for production chargers | **MUTATION — approval** |
| 3.7 | Create production queues, DLQs, R2 bucket | **MUTATION — approval** |
| 3.8 | Full smoke on workers.dev hostnames | verification |

Production is proven before it is reachable. No customer can hit a half-built
estate because no customer-facing name points at it.

## Stage 4 · The one customer-visible step

| # | Action | Type |
|---|---|---|
| 4.1 | **Capture the beta web Worker's active version id** | read-only — **rollback target** |
| 4.2 | Screenshot/record current custom-domain attachment | read-only |
| 4.3 | Attach `straumvakt.org` + `www` to `straumvakt-web` | **MUTATION — approval** |
| 4.4 | Detach them from the beta web Worker | **MUTATION — approval** |
| 4.5 | Attach `api.straumvakt.org` to `straumvakt-api`; detach from beta | **MUTATION — approval** |
| 4.6 | Post-cutover smoke (below) | verification |

**Expect a window where a hostname serves from neither Worker** while DNS and
certificates settle. Schedule it; do not discover it.

**TTL and certificate assumptions:**
- `custom_domain: true` provisions DNS via CNAME flattening on the apex, plus an
  Advanced Certificate.
- **Deleting a custom domain does not delete its certificate** — documented by
  Cloudflare. Re-attachment may or may not reuse it cleanly; **verify TLS
  explicitly rather than assuming**.
- Cloudflare-proxied records are not classically TTL-bound, but certificate
  issuance is not instant. Budget minutes, not seconds.
- **Undocumented and therefore a stop condition:** whether a deploy whose config
  omits `routes` detaches a live custom domain. `origin/staging` has no `routes`
  block today while the domains are live, so this case is *already* in
  production. Resolve it in Stage 0.

## Stage 5 · Observe and bake

| # | Action |
|---|---|
| 5.1 | Watch 15 minutes minimum: 5xx rate, TLS, both hostnames |
| 5.2 | Keep the beta Worker **deployed, warm, with its secrets intact** for the bake period |
| 5.3 | Do **not** delete anything |

## Stage 6 · Retire, only after an explicit window

| # | Action | Precondition |
|---|---|---|
| 6.1 | Rename beta Workers to `straumvakt-web-beta` / `straumvakt-api-beta` | mobile release has moved off the pinned host |
| 6.2 | Remove brand domains from beta config | bake complete |
| 6.3 | Delete obsolete Workers | **only** with CPMS settled (Stage 1.4) — otherwise a CPMS push recreates the name |

## Post-cutover smoke tests

| # | Test | Expected |
|---|---|---|
| S1 | `GET https://straumvakt.org/` | 200, login page, **body differs from the beta Worker's** |
| S2 | `GET https://www.straumvakt.org/` | identical to S1 |
| S3 | TLS on both | valid, correct CN/SAN |
| S4 | `GET https://api.straumvakt.org/api/admin/me` | `401 {"error":"unauthorized"}` |
| S5 | `GET https://beta.straumvakt.org/` | 200 — **beta still reachable** |
| S6 | Authenticated login round-trip on production | cookie set with correct domain |
| S7 | A DB-backed authenticated read | production Neon, **not** beta |
| S8 | Charger connectivity | beta chargers still on the beta gateway |
| S9 | Mobile app against its pinned host | unaffected |

**S7 is the one that matters most.** A production web Worker accidentally bound
to the beta database is the worst outcome of this runbook — it looks entirely
healthy and silently mixes customer and test data.

## Rollback

| Failure | Action | Reversible |
|---|---|---|
| Production misbehaves after 4.3 | Re-attach brand domains to the beta Worker — still warm | ✅ minutes |
| Bad version on production | Cloudflare rollback to the captured version id | ✅ |
| Domain detached unexpectedly | Re-attach; verify TLS separately | ✅ |
| Wrong database bound | **Stop writes immediately**, then repoint | ⚠️ writes may need reconciliation |
| Beta Worker deleted | **none** | ❌ — hence Stage 5.3 |
