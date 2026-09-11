# Straumvakt — Connected Test Frontend: Integration Map

**Live:** https://test.straumvakt.org (fallback: https://straumvakt-test.straumvakt.workers.dev)
**Branch:** `codex/straumvakt-connected-test-frontend` · **Worktree:** `E:\Claude\Straumvakt-connected-test`
**Date:** 2026-09-11

## What this is
The supplied dark-navy/mint Admin/CPO console (`straumvakt-cpms-blueprint`) was fixture-only
(no network layer, demo persona/`mayWrite`). It is now connected to a **real, isolated test
backend**: a small `road-to-market` Worker (`apps/road-to-market/src/index.js`) that reuses the
harvested Drizzle schema + the org-scope/permission shape from `apps/api`, serving the frontend
and a scoped read API from one origin against a **fresh test database** (`straumvakt_test`).

The console's in-memory arrays are now **hydrated from the API** behind a real login gate
(`apps/road-to-market/frontend/src/connect.js`); persona/orgs come from `/api/admin/me`; the
`nordur` demo hardcode is replaced by real tenancy; **all writes are disabled** (this test API is
read-only) and screens without a backend show empty/labelled states.

## Backend = proven work, not a rewrite
Per the new-build manifest the old `apps/api` "keeps running as-is, then is switched off in one
step" — it is the proven surface. Rather than deploy the 250-route legacy Worker (which binds the
live gateway/queues/cron), the test Worker exposes **only the identity + org-scoped read operations
the console needs**, safe-by-construction (no gateway, queue, cron, email, or R2 bindings). Auth
(HMAC cookie), tenancy (`org_id` scope), and precedence logic are reused, not reinvented.

## Environment
| | |
|---|---|
| Worker | `straumvakt-test` (account `1b2fc4c163e8544e9cd472baa5a19c74`) |
| DB | Neon project `spring-leaf-73019190`, branch `test-to-market` (`br-royal-recipe-abas9e5u`), database `straumvakt_test` — **fresh, no legacy customer data** (branched off the 37 MB `production`, not the 480 MB `staging`) |
| DB access | `@neondatabase/serverless` over HTTPS; connection string is the `DATABASE_URL` **secret** (never in the browser) |
| Auth | host-only cookie `straumvakt_test_session` (HMAC-SHA256, `AUTH_SECRET` secret); `Secure; HttpOnly; SameSite=Lax`; **no Domain** → cannot collide with `*.straumvakt.org` |
| External effects | **none possible** — no gateway/queue/cron/email/R2 bindings exist on this Worker |

## UI → API → repository/schema → permission → status

| Console screen | Frontend fn | API endpoint (this Worker) | Source tables (schema) | Permission model | Status |
|---|---|---|---|---|---|
| Login gate | `connect.js renderLogin` | `POST /api/admin/login` | `identity.users` + `identity.user_credentials` (PBKDF2, 100k) | drivers rejected; HMAC cookie minted | **Connected** |
| Identity/persona | `connectBootstrap` | `GET /api/admin/me` | `identity.platform_grants`, `tenancy.memberships`⋈`organizations` | persona = operator/host_admin/member | **Connected** |
| Sign out | banner `#rtm-logout` | `POST /api/admin/logout` | — | clears cookie | **Connected** |
| Overview / Organisations | `v2Overview` / `v2Organisations` | `GET /api/admin/orgs` | `tenancy.organizations` (+counts) | platform-only (mirrors `platform.tenant.read`) | **Connected** |
| Sites | `sitesPage` | `GET /orgs/:orgId/sites` | `properties.sites`, `properties.site_assets` | platform OR member of `:orgId` | **Connected** |
| Chargers (via Sites) | `scopedChargers`/site view | `GET /orgs/:orgId/chargers` | `assets.charging_stations`⋈`site_assets`⋈`installations`⋈`evses`⋈`connectors` | platform OR member | **Connected** |
| Drivers | `v2Drivers` | `GET /orgs/:orgId/drivers` | `tenancy.memberships`⋈`identity.users`⋈`agreements.driver_groups` | platform OR member | **Connected** |
| Sessions | `sessionsPage` | `GET /orgs/:orgId/sessions` | `charging.sessions`⋈`reports.session_ledger`⋈`site_assets`⋈`users` | platform OR member | **Connected** |
| Installations | `v2Installations` | `GET /orgs/:orgId/installations` | `properties.installations`⋈`sites` | platform OR member | **Connected (read)** |
| Agreements | (data loaded) | `GET /orgs/:orgId/agreements` | `agreements.agreements` | platform OR member | **Connected (read)** |
| Any create/edit/delete/commission/remote | forms/`saveEntity` | — | — | **blocked client-side + no write API** | **Read-only (gated)** |
| Tariffs | `tariffsPage` | — | (sample calculator only) | — | **Sample — not wired** |
| Billing / Platform-billing | `billingPage` | — | (`session_ledger` exists; formula not wired) | — | **Not wired** |
| Contracts / Incidents / Team / Audit | `v2Contracts`/`incidentsPage`/`v2Team`/`auditPage` | — | (empty in test) | — | **Empty — not wired** |
| Whole-product (`ecosystem.html`): Issues / Community / Service | ecosystem app | — | **no backend exists anywhere** (parked, ADR/FOCUS) | — | **Blueprint only** |

## Server-enforced tenancy (verified)
`orgGuard()` in the Worker allows an org-scoped read only if the caller `isPlatform` **or** is an
active member of `:orgId`; otherwise 403. Verified: host of Norðurorka Test gets its own chargers
and **403 on Vestan Test** — both via the API and reflected in the UI (CPO never sees the other org).

## Honest limits (do not overstate)
- **Reads only.** No create/edit/onboarding/commissioning/command writes are wired.
- **Device/placement/effective-dating (ADR 0054)** is decided but **not built** — schema is still the
  pre-reshape single-table charger model. See `DB-MODEL.md`.
- **Invoice/statement/delivery tables do not exist** in the schema; only sessions→ledger is real.
- **Issue-resolution / neighbour-help / service-desk** have no backend anywhere (parked).
- Synthetic data only. Never presented as real customers.
