# Sprint 8 — Tariff Engine + Billing Dashboard + Zaptec API Stack · Retrospective

**Dates:** 2026-05-03 → 2026-05-05 (~3 working days, dense)
**Original exit criterion:** Tariff engine + session-cost computation
+ billing dashboard read surface so closed sessions show cost on
`/charge-log`.
**Actual exit criterion:** All of the above PLUS a complete API-only
ingest stack for Zaptec installations where OCPP isn't running
(probe + writeback + status poller + webhook receivers + tariff-chain
UI + site-move + session-detail modal). **Status: met and overshot.**

Sprint 8 was supposed to be billing math. It evolved into a full
"how do we run an installation when OCPP is off" stack because
Dalvegur 10–14 — the pilot's only real-world site — flipped from
OCPP auth to Zaptec-Native auth mid-sprint and the team had to
adapt the ingest path on the fly. The tariff engine landed in the
first day; the next two days were spent making API-only ingest a
first-class path with feature-parity to OCPP-first.

Two operational incidents, both retro'd in dedicated docs:
- AuthType=Webhooks lockout (2026-05-04 morning) — empty IdToken
  table → mass driver denial; recovery via Zaptec-portal toggle.
  See `docs/incidents/2026-05-04-zaptec-authtype-webhooks-lockout.md`.
- Status / sessions cron OAuth contention — alternating tick failures
  caused by two unsealAndAuth calls back-to-back hitting Zaptec's
  /oauth/token rate limit. Fixed by a single combined orchestrator
  (8.14.1).

---

## What shipped (in chronological order)

### Tariff engine + billing dashboard (the original sprint scope)

| Milestone | Commit | Notes |
|---|---|---|
| 8.2 — Pure-function tariff engine | `7d64ba5` | apps/api/src/lib/tariff/compute-session-cost.ts. TariffComponent / TariffChain / CostBreakdown types. 16 hand-computed scenarios validating canonical Iceland case (30 kWh × Veitur AD1 + N1 = 649.88 kr). BigInt money math; no float. |
| 8.3 — Tariff-chain resolver | `603b3c9` | Reads Site.dsoTariffId + Installation.retailerTariffId, parses computeRule JSONB, composes chain. Throws TariffResolutionError with discriminated codes. |
| 8.4 — Billing read repo + /charge-log | `c2d7046` | session-ledger.ts with five tagged scopes (admin / org / site / charger / driver). GET /api/admin/billing/sessions. Top-level /charge-log page. |
| 8.5 — session.stopped writes session_ledger | `64cc27c` | onSessionStopped projection extended to call resolveTariffChainForSession + computeSessionCost + driverUserId resolve via idTag → IdToken → user. Upsert reports.session_ledger. Same path the synthetic-session writeback uses today. |

### Zaptec API-only ingest stack (the unplanned half)

| Milestone | Commit | Notes |
|---|---|---|
| 8.6 — API-fallback session probe | `3c1f6dc` | Read-only diff between Zaptec ChargeHistory and our session_ledger. Three buckets: bothInOurs / onlyInZaptec / onlyInOurs. Match heuristic: same ChargerId + start-time within ±2 min. |
| 8.7 — API-only session writeback | `5bfa7e7` | Synthesises ChargeSession + ImportedCdrRef + session_ledger rows for Zaptec sessions that don't exist on our side. Idempotent on (sourceKind, sourceCdrId) unique index. Same Veitur AD1 + N1 chain. */5 cron orchestrator runs across all active credentials. |
| 8.8 — Charger-status poller | `8522354` | Sister cron to 8.7. Walks /api/chargers per credential, maps OperatingMode → OcppIdentity.status, stamps lastSeenAt. Single REST call per credential. |
| 8.8.1 hotfix — lookup field | `c00e0ca` | OcppIdentity.vendorResourceId stores Zaptec internal UUID (Charger.Id), NOT DeviceId. Status poller had been matching on DeviceId, updating zero rows. Caught when operator reported "all chargers offline" after the move. |
| 8.9 — Webhook receivers | `7f856e3` | Three HTTPS endpoints under /api/webhooks/zaptec: /auth, /session-start, /session-end. Bearer-secret-gated. PARKED: AuthType=Webhooks needs IdToken seeded first (see 8.9.2). |
| 8.9.1 — Webhook diagnostic mode | `b1030ad` | ZAPTEC_WEBHOOK_DIAGNOSTIC env flag for fail-open observation while we figure out auth payload shape. |
| 8.9.2 hotfix — /auth fail-OPEN in diagnostic | `af63246` | Incident response: empty IdToken table on Dalvegur Native-auth → mass lockout when AuthType flipped to Webhooks. Fix: in diagnostic mode `/auth` returns Accept regardless of IdToken state. Tests lock the behaviour. |

### Operator console — orgs, contracts, tariff chain, site-move

| Milestone | Commit | Notes |
|---|---|---|
| 8.10 — Per-org Tariff chain tab | `b0dda14` | Walks every Site + Installation under an org, shows bound DSO + retailer tariffs inline with rate cards. Direct answer to "what is each site under this org being charged?". |
| 8.11 — Site-move on Installation page + Contracts → Cost arrangements | `8834eb8` | Move-site action available from the installation page. Cleared up Contracts vs tariff-chain naming confusion. |
| 8.12 — N1 catalogue + bilateral Dalvegur contract | `7546bf4` | Seeded N1's tariff catalogue (Veitur AD1 + N1 RAFMAGN-REPF-01) so Dalvegur (now under N1) bills against N1's own rows. Created mirrored Contract rows on both sides. |
| 8.13 — Manageable contracts + 12-min online window | `7ca28e2` | Detail page + edit/delete plumbing. Online-window race fix (5 min was racing the */5 cron; bumped to 12 min). |
| 8.14 — Counterparty FK + cross-org site-tree + orphan-property cleanup | `73426dc` | Schema reshape: ALTER TABLE billing.contracts ADD COLUMN counterparty_org_id (Rule 4 additive). Collapsed the dual Dalvegur rows into one bilateral row visible to both sides. Site-tree vendor-resource map made cross-org so credentials can manage chargers in different orgs after a move. moveSiteToOrg auto-deletes the source-org Property when it becomes site-less. |
| 8.14.1 hotfix — Single OAuth grant + per-installation chargehistory | `5cca00e` | Two distinct issues, one shared root cause. Rule-5 stop-and-summarize. Found via wrangler tail. Combined sessions + status crons under one access-token-per-credential. /api/chargehistory now scoped per installation (Zaptec returns nothing without InstallationId filter). |
| 8.14.2 — Manual sync fans out per installation | `9ff80c7` | Mirrors the cron orchestrator's fan-out for the operator-driven backfill route. |
| 8.14.3 — Enrich ChargeSession from full ChargeHistory shape | `6622b1a` | Widened ZaptecChargeHistoryEntry to capture every field observed (DeviceName, ChargerFirmwareVersion, SignedSession, ExternallyEnded, etc.). Driver-attribution priority: UserFullName → first+last → TokenName → username → email. |
| 8.14.4 — Surface enriched session data on /charge-log | `2df7566` | session-ledger repo batch-loads 4 enrichment tables (chargeSession.stopReason, siteAsset.displayName, site.displayName, organization.displayName). Three new columns: Charger / Site-Org / Stop reason. |
| 8.14.5 — DetailLevel=1 + full Swagger type widening | `ddd872d` | Pass DetailLevel=1 by default; type extended to capture every field documented (TokenName, EnergyDetails, ChargerFirmwareVersion as object, SignedSessionEichrecht, ReplacedBySessionId). Driver-match candidates now include UserId + TokenName. |
| 8.14.6 — Charger names + clean stop reasons on /charge-log | `14d9e7c` | Status cron also writes through SiteAsset.displayName. enrich-existing-sessions.ts back-filled the 27 historical Dalvegur rows: charger names from rawPayload.DeviceName, firmware from formatted ChargerFirmwareVersion object, stop reasons normalised away from the placeholder. |

### Session-detail modal

| Milestone | Commit | Notes |
|---|---|---|
| 8.16 — Session-detail modal with power/kWh chart | `b65f848` | Click any session UID on /charge-log → modal with header + 700×280 SVG chart. Power bars (sky-blue charging, slate-grey idle) + cumulative-kWh polyline (amber). Time series from EnergyDetails when present, otherwise parsed from OCMF SignedSession. Custom OCMF parser at apps/api/src/lib/ocmf.ts (no signature verification — visualisation only). |
| 8.16.1 — Session UID first column with chip-button styling | `8382881` | Session column promoted to position 1 (was last). Chip-button styling with sky-coloured border, "↗" suffix nudge on hover, focus ring, active-press translation. |

### Sprint 9 Phase 1 + 2 — Zaptec consumer scaffolding (started during Sprint 8 close)

Pushed to `dev/zaptec-consumer-fly` branch, NOT yet deployed:

- Phase 1 — Node consumer skeleton on Fly.io (apps/zaptec-consumer/). Dockerfile, fly.toml (region: ams), structured logging, /health, multi-installation supervisor, exponential-backoff reconnect. `0c20a90`.
- Phase 2 — Claim-check trigger pattern. Consumer extracts ChargerId from any AMQP message, posts to /api/internal/zaptec-trigger-sync (deployed on the API branch as part of Sprint 8 close, `3254e34`). The endpoint runs the existing syncZaptecSessions filtered to that charger + 1h window. AMQP message body never translated — REST is the source of truth for session payloads.
- Operator deploy script (apps/zaptec-consumer/scripts/deploy.ps1) — one-command walk-through with masked-input secret prompts, stdin-piped to `flyctl secrets import`. Awaits operator run.

### Verification at sprint close

- `npx prisma validate` — clean.
- `npx tsc --noEmit` — clean across root, apps/api, apps/zaptec-consumer.
- apps/api vitest — **258/258 pass** (was 189 at Sprint 7 close; +69 new across tariff engine, resolver, session ledger, contracts, site-tree, webhooks, sync, status poller, OCMF parser).
- One migration applied to staging Neon: `20260504210000_contract_counterparty_org_id` (additive, reversible).
- Both Workers redeployed many times during the sprint; final versions:
  - apps/api `9cd23c5a-b72a-485a-900d-29617cc2c1b0`
  - UI `9fa36b40-5b93-41c6-b430-d3466323a89f`
- Operational state at close:
  - Dalvegur: 27 historical sessions enriched on /charge-log with charger names + costs (Veitur AD1 + N1 = 21.66 kr/kWh inc-VAT)
  - 5-min sessions cron: pulls per-installation chargehistory with DetailLevel=1
  - 5-min status cron: stamps OcppIdentity.lastSeenAt + SiteAsset.displayName + ChargingStation.firmware
  - One bilateral Contract row visible from both N1 and Straumvakt sides
  - Site-move tested live (Dalvegur Straumvakt → N1)

---

## Decisions made (ADRs / in-flight)

### Captured

- **Native auth + Service Bus AMQP is the architectural ideal for the
  operator-pilot model.** Discussed at length once we understood the
  Zaptec channel matrix. Native = Zaptec owns RFID list (no IdToken
  seeding burden, no lockout risk). Service Bus is independent of
  AuthType, gated on `MessagingEnabled`. Together: real-time event
  push without owning auth. Unverified empirically because the AMQP
  probe wasn't yet run at sprint close.

- **Claim-check pattern over event-translator.** When the AMQP
  consumer landed, the design choice was: translate Service Bus
  messages → IngestEvent (heavy, schema-coupled, brittle to Zaptec
  changes) vs. use AMQP as a "go look now" signal and pull
  authoritative data via REST (light, schema-free, reuses existing
  writeback). Picked the second. Trade: slightly more REST traffic,
  much simpler integration. Fits the data we have today and any
  schema Zaptec might emit tomorrow.

- **`ImportedCdrRef.(sourceKind, sourceCdrId)` as the canonical
  vendor-CDR idempotency slot.** Saved to memory. Don't add
  `externalSessionId` to ChargeSession; the V3 schema already
  anticipated this with the imported_cdr_refs sibling table.

- **Cross-org credential-to-charger lookup in site-tree.** Bug from
  the move: vendor-resource map was per-org, missed every Dalvegur
  charger after the move because the credential stayed with
  Straumvakt while the OcppIdentity rows moved to N1. Fix made the
  lookup cross-org. Decommissioned-by-omission detection moved to
  a post-pass that runs after every credential's listChargers
  finishes, not per-credential.

- **Single OAuth grant per credential per cron tick.** Forced by
  Zaptec's /oauth/token rate limit. Memory had captured this, but
  the implementation slipped through into two separate crons that
  were racing each other. Now combined.

- **Stop-reason normalisation: "ExternallyEnded: true" is normal
  for Native auth, NOT anomalous.** Zaptec App initiates every
  stop. Default to "Completed" unless an explicit OCPP-style
  StopReason is provided.

### Deferred (named in commit messages)

- **Sprint 9 ADR — Contract enrichment.** Counterparty FK landed
  but the deeper layer (parent-contract per Installation,
  Contract → TariffDefinition resolution path) is one ADR away.
- **NOT NULL `Site.dsoTariffId`** — schema tightening. Today
  resolveTariffChainForSession throws on null; the enforcement
  could move into the schema with a backfill check + migration.
- **`SignedSessionEichrecht` parsing** — German calibration-law
  variant, separate signature format. Captured into rawPayload;
  parser deferred until we sell into a market that requires it.

---

## What slipped (or shifted)

### 1. Sprint 9 Phase 2 not running yet

API endpoint deployed; consumer code pushed to dev/zaptec-consumer-fly
but no Fly app deployed because flyctl auth + Fly secrets are
operator-side actions (Rule 2 keeps secrets out of chat). Awaits
operator running `apps/zaptec-consumer/scripts/deploy.ps1`. Decisive
moment is the first `zaptec_amqp_connected` log line — answers the
"is `MessagingEnabled` even on?" question that's been hypothetical
all sprint.

### 2. AMQP probe never run

Local probe script (`apps/api/scripts/probe-zaptec-amqp.ts`) ready;
needs the Zaptec password env-var on the operator's shell. Same
gating as #1. The deployed consumer-on-Fly path is a superset of
the probe, so #1 dominates.

### 3. April + May 2026 backfill not run

Manual sync route fans out per installation now. One browser
dev-tools fetch with `from=2026-04-01&to=2026-06-01` triggers the
backfill. Not yet run; would land hundreds more sessions enriched
on /charge-log. ~30s when triggered.

### 4. Driver attribution at Dalvegur — confirmed unsolvable in-channel

Empirical finding from inspecting actual rawPayloads: Native auth
strips `userId / userFullName / userEmail / tokenName` from
/api/chargehistory regardless of DetailLevel. Confirmed against
Zaptec swagger (fields are documented; empty for Native-auth
installations). For installations WITH authentication active, the
same pipeline returns full driver info (per the ZPR074053 example
the operator pasted, "Magnús Möller / 0202635399 / 100016009").
Memory updated; this is an architectural ceiling, not a bug.

### 5. 1-min meter resolution — not achievable on Native auth

OCMF blobs and EnergyDetails arrays both surface 15-min ticks.
1-min would require OCPP MeterValues at the installation, which
Native auth doesn't expose. Operator notified; the session-detail
modal renders 15-min resolution which matches Zaptec's portal
view.

### 6. SOC unavailable

Same root cause as #5. Modal footer notes the absence; no data
source available without OCPP MeterValues with the SoC measurand.

### 7. Sprint 8.4.x — per-entity Sessions tabs

API supports the scopes (org/site/charger/driver). UI surfaces
on the per-entity profile pages don't exist yet. Today /charge-log
is platform-wide only. Not blocking; pilot operator works fine
with the platform-wide view.

### 8. Sprint 8.15 — Tariff CRUD UI

Today `/billing/tariffs/new` form exists but the backing API doesn't.
Tariff edits go through SQL. Operator-facing editor deferred
until we have more than one tariff catalogue to manage (today: two
N1 rows + two Straumvakt rows, hand-managed).

---

## Operational lessons / incidents

### Incident 1 — Dalvegur AuthType=Webhooks lockout (2026-05-04 morning)

Documented in `docs/incidents/2026-05-04-zaptec-authtype-webhooks-lockout.md`.
Empty IdToken table + flipping AuthType=Webhooks = mass denial.
Fixed by reverting the Zaptec-portal toggle. Hardened in 8.9.2:
diagnostic mode is now fail-OPEN on `/auth`. Memory updated:
`AuthType=Webhooks needs seeded IdToken`.

### Incident 2 — Cron alternating-failure pattern

Discovered via `wrangler tail`. Two unsealAndAuth calls back-to-back
hit Zaptec's /oauth/token rate limiter; the loser dropped its tick.
Memory had captured the rate-limiter behaviour but the
implementation drifted. Fix in 8.14.1 collapsed the two crons into
one shared-token orchestrator. Adds a third side benefit:
per-installation chargehistory fetch (which Zaptec requires for
data) is naturally orchestrated alongside.

### Live in-flight discovery from operator-side checks

Several findings came from the operator clicking around in real
time and reporting "X is broken":
- Charger bubbles all gray after move (cross-org credential-map fix)
- Contracts duplicated (counterparty FK + collapse migration)
- Stop reason every row amber (ExternallyEnded normalisation)
- Charger names showing UUIDs (SiteAsset.displayName write-through)
- Session UID column hard to spot (8.16.1 chip-button + first column)

Lesson: real-time UI feedback during sprint development surfaces
issues the test suite can't (display affordances, naming
collisions, multi-row pattern problems). Worth keeping the
operator in the loop with hard-refresh checks throughout.

### Schema mismatch trap

`apps/api/prisma/schema.prisma` and root `prisma/schema.prisma` are
two separate copies that need to stay in sync. I overwrote the
apps/api one when applying the counterparty FK; restored from git
and applied the change surgically. Memory for next time: edit both
files, run `prisma generate` in both workspaces, run tsc in both.

---

## Carry-forward to Sprint 9

1. **Run `deploy.ps1` on Fly** — turns Phase-2 architecture from
   "shipped" to "running." First `zaptec_amqp_connected` line in
   `flyctl logs` answers `MessagingEnabled` empirically and unblocks
   either:
   - "great, now wire driver attribution from AMQP events" (if
     auth events arrive with cardId visible), OR
   - "Native auth is REST-and-AMQP-anonymous, accept the ceiling"
     (and the pipeline still gives sub-second session-end ingest
     for sites without OCPP).
2. **Run the April + May backfill** — single fetch, idempotent,
   adds ~hundreds of enriched rows to /charge-log. Closes the
   "we have a partial picture" gap.
3. **Sprint 9 Phase 3 hardening** — bounded retry queue with
   disk spill on consumer, DLQ for malformed AMQP payloads,
   /health depth surface, operator-console page that renders
   per-installation last-message-received freshness from Postgres.
4. **Decide on driver attribution path** — operator-driven CSV
   export from Zaptec portal vs. waiting for AMQP probe results
   vs. accepting Native-auth-anonymous as architectural truth.
5. **Sprint 8 close-out items** — per-entity Sessions tabs,
   tariff CRUD UI, Contract-enrichment ADR (8.15 / 8.4.x / 9.x).

Sprint 8 closes with billing math + cost computation working
end-to-end and a complete Zaptec API ingest path. The architectural
question of whether AMQP delivers driver attribution stays open;
the rest of the system doesn't depend on the answer.
