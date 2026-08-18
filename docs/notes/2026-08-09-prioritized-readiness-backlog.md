# Prioritized readiness backlog

Companion to [the main packet](2026-08-09-overnight-readiness-audit.md).
Every item cites evidence and states an acceptance criterion. No item says
"improve X".

Type: **C**ode · **I**nfrastructure · **D**ata · **P**roduct · **H**ardware

---

## P0 — launch blockers

### P0-1 · Stop emitting fabricated telemetry (C)

| | |
|---|---|
| Evidence | `apps/api/src/repositories/driver-sessions.ts` — `powerKw: 0` hardcoded; `whToKwh`/`minorToIsk` return `0` for `null` |
| User impact | A driver mid-charge sees **"0.0 kW · 0 kr"** — reads as *nothing is happening and it is free* |
| Owner | backend (`driver-sessions.ts`) |
| Dependency | none — the DTO already permits null and `active_session.dart:189-209` already guards on null |
| Acceptance | `powerKw` is `null` (never `0`); `energyKwh`/`costIsk` are `null` when the column is null. AC-22–25 pass |
| Note | **The smallest high-value change in this audit.** No new data source, no Dart change |

### P0-2 · Decide and implement live-power provenance (C/P)

| | |
|---|---|
| Evidence | No power source exists; the repo comment claims a "charger-status surface" the app never calls |
| User impact | Either the app shows live power, or it must stop implying it will |
| Options | (a) add a charger-status read; (b) derive from meter values; (c) **ship without live power** and remove the tile |
| Acceptance | One option chosen and implemented; no UI element implies a measurement that does not exist |
| Note | (c) is legitimate and shippable. P0-1 makes (c) safe on its own |

### P0-3 · Rate-limit driver login (C)

| | |
|---|---|
| Evidence | `driver.ts:121` has no middleware; `driver.ts:1029-1036` rate-limits `/claim-invite` with a binding named `DRIVER_LOGIN_RATE_LIMITER`; admin login uses `ADMIN_LOGIN_RATE_LIMITER` |
| User impact | Unthrottled credential stuffing against driver accounts |
| Acceptance | AC-05 passes — 429 after threshold, by IP; limiter binding present in `wrangler.jsonc` |
| Note | Almost certainly a misplacement, not an omission — the binding name names the route it is missing from |

### P0-4 · Remove fabricated vehicle claims (C/P)

| | |
|---|---|
| Evidence | `apps/mobile/lib/screens/number_plate.dart` prototype; **no driver vehicle API exists in `apps/api`** |
| User impact | The app asserts make/plate/battery/range/year/Autocharge it cannot know |
| Owner | Codex (in progress — `my_vehicle.dart`) |
| Acceptance | M-2 and M-3 — no unbacked assertion; prototype assets preserved, not presented as live |

### P0-5 · Resolve the Cloudflare release blockers (I) 🔒

| | |
|---|---|
| Evidence | `docs/notes/2026-08-08-infra-release-safety-packet.md` §A1 — six gates blocked. **Not linked:** that file lives on branch `docs/infra-release-safety-packet` (`856ebe2`) and is not in this branch's tree |
| Acceptance | Git-integration state, owning repo, deployed version ID, custom-domain retention, Hyperdrive target and secret names all recorded |
| Note | Unchanged by this audit; carried forward because it still gates the release |

---

## P1 — immediately after launch

| # | Item | Type | Evidence | Acceptance |
|---|---|---|---|---|
| P1-1 | Surface history / session detail | C | `/sessions/history`, `/sessions/:id` have **no caller** | Screens ship; AC-35–37 pass |
| P1-2 | Rename the "invoices" surface | P | `/invoices` returns charge sessions, per its own comment | No UI says "Invoices" without an invoice document; AC-38 |
| P1-3 | Reconcile history vs billable sources | C/P | two tables, different latency (lifecycle §6) | One source, or the difference is explained in UI; AC-39 |
| P1-4 | Add a currency field to money DTOs | C | `costIsk` is a bare number; `Organization.defaultCurrency` exists | DTO carries amount + currency + exponent |
| P1-5 | Map real connector state | C | `status: "Charging"` is a literal | Reflects actual connector state |
| P1-6 | Surface pending-approval flow | C | `POST /access-requests` has no caller | AC-09 |
| P1-7 | Pricing preview | C | `/chargers/:id/pricing` has no caller | Driver sees price before starting |
| P1-8 | Refresh-token revocation | C | stateless, 30d, no kill switch | An operator can revoke a driver's tokens |
| P1-9 | Support / privacy / terms | P | partial in `menu_drawer.dart` | Store-listing requirements met |

---

## P2 — scale and operational maturity

| # | Item | Type | Evidence | Acceptance |
|---|---|---|---|---|
| P2-1 | Load-test to 1k / 4k / 5k connectors | I | design capacity never measured | Plan below executed; bottleneck ranked by measurement |
| P2-2 | Model DO connection ownership at 5k | I | gateway DO owns per-charger WebSockets | Documented fan-out limit with headroom |
| P2-3 | Postgres connection ceiling under Hyperdrive | I | per-request client, `max: 1` | Measured ceiling vs. 5k concurrency |
| P2-4 | `cpu_ms: 50` audit for fan-out handlers | I | `wrangler.jsonc:14-16` | No handler exceeds budget at 5k |
| P2-5 | Cost-projection lag SLO | D | drivers see cost only post-projection | Stated target; alert when breached |
| P2-6 | Queue backpressure / DLQ policy | I | queues exist; policy undocumented | Documented and alerted |
| P2-7 | Neon branch protection | I | `staging` and `production` both `protected: false` | Enabled (approval-required) |
| P2-8 | Dependency/licence inventory | C | not performed; **no upgrades attempted** | Inventory exists |

### Load-test plan (not executed)

| Profile | Shape | Success metric |
|---|---|---|
| L1 steady | 1k connectors, 1 heartbeat/30s, 5% charging | p95 ingest < 500ms, queue depth ~0 |
| L2 target | 4k connectors, 10% charging, 200 starts/hr | p95 < 1s, no DLQ growth |
| L3 stress | 5k + reconnect storm (all reconnect within 60s) | recovery < 5 min, no data loss |
| L4 billing | 50k completed sessions projected in one window | projection completes; driver-visible lag < SLO |

Run against a **disposable Neon branch** and a non-production Worker only.

---

## Parked product ideas

| Idea | Why parked |
|---|---|
| Autocharge / EVCCID driver binding | No enrolment flow; ingest-side identity only. Needs a contract before it is product |
| Notifications | No implementation anywhere |
| RFID self-service | `IdToken` model exists; no driver surface |
| Charger BLE settings in driver IA | Works, but **is it a driver feature?** — see decision register |
| Vehicle configurator (full) | Needs the vehicle-account API P0-4 defers |
