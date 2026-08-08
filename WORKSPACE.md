# WORKSPACE.md — Straumvakt structural snapshot

Purpose: a lightweight, **diffable** description of the workspace. Update it at
each milestone; `git diff` it to see and discuss structural drift. Prose is kept
minimal on purpose — the diff should read clean. This is a map, not a manual;
the active rules live in FOCUS.md.

Snapshot: 2026-08-08 · seed from verified reads + adopted plan.
**Reconcile once against the live tree on first commit** — some lines below are
in-flight (marked by status), and the first diff is meant to true them up.

Status vocab: `live` · `proven` · `harvesting` · `forming` · `home-only` ·
`parked` · `legacy` · `new`

---

## Phase & build model
- Phase: **market-focus** — FOCUS.md is active canon; the ADR corpus is legacy reference.
- Build model: **harvest into a clean shell (strangler)** — copy proven code into
  clean packages, retire the old only after parity. Not a rewrite, not build-on-top.
- ORM: **Drizzle owns the schema** (the schema is the asset). Prisma converts
  per touch-it-convert-it; "retire Prisma entirely" is a residual finish, not a sprint.
- Money: **one engine, N money-lines** keyed by `{whose money, posture, counterparty}`.
  Live line: Straumvakt→host (principal). Deferred: host→driver (agent).

## Layout  (path — purpose — status)
- `/` — Next.js web console `hlada` + workspace tooling — `live` (move to apps/web: `parked`)
- `packages/shared` — db schema · domain · inputs — `harvesting` → contracts/db/modules
- `packages/contracts` — canonical vocab · adapter interface · money-line shape — `new` (shell spine)
- `packages/db` — Drizzle schema SoT + hybrid raw-SQL hot path — `forming`
- `packages/commercial` — money engine (agreements→ledger→invoice) — `home-only`
- `apps/api` — Hono Worker, hot path — `live` (harvest target)
- `gateway` — OCPP engine, DO-per-identity — `proven` (21 live chargers) · DO NOT reshape hostname
- `apps/zaptec-consumer` — Fly claim-check vendor sync — `live`
- `apps/mobile` — Flutter driver app — `live` (partial)

## Deployables × tiers
- Tiers: Local (per-dev) · **Dev (shared, `new`)** · Staging · Prod
- Services: web (`hlada`) · api · gateway · vendor-sync (Fly)
- Deploy: per-service **path-scoped** (target) — replaces the whole-tree push trigger
- Prod: **STALE** (April copy) — clean rebuild from migrations pending

## Data & schema
- Neon branches: primary (prod) · staging · dev (`new`) · test (parity) · per-dev scratch
- Schema owner: Drizzle. Prisma mirrors still present: **2** (`prisma/`, `apps/api/prisma/`)
- Migration flow: `db:generate:sql` → review → test → dev → staging → prod (each gated)
- `drizzle-kit push`: **banned**

## Boundaries & health  (the diffable heartbeat)
- Domain order: `commercial → charging → protocol → assets → identity`
- Absolutes: vendor at the edge · platform is a leaf · catalog free to import
- depcruise baseline: **24** (22 vendor · 1 cycle · 1 identity→higher) — target → **0**
- `packages/`: **1** (shared) → target 4 (contracts, db, core, commercial) + shared shim
- `apps/`: api · mobile · zaptec-consumer · (gateway standalone, outside workspaces)
- ADRs: **51** → legacy reference; active canon = FOCUS.md  ← rising count = ceremony returning
- Prisma: converting — mirrors **2**, ~**500** calls at ADR 0051 — track both → 0

## Active workstreams
1. **CDR → invoice ledger** — flat-fee / principal line first (no attribution needed)
2. **Onboarding** — org self-enroll → invite users → attach chargers → set flat-fee agreement
- Enabling (by-product, not a sprint): Drizzle conversion on touched files · proper envs

## Parked  (item — un-park trigger)
- Team-scale split M2–M4 / governance — after first revenue
- **Attribution / createDriver — FIRST un-park** (unlocks the host→driver line + differentiator)
- Service vertical · Flex/DER · Issues Engine — future products
- Full cost-center (DSO-by-address · retailer choice · home reimbursement · contractor 10% · premium/CC)
- Installation dissolution (ADR 0047) · roaming · OCPP 2.0.1 · BLE · NFC

## Canon pointers
- FOCUS.md — active rules · DECISIONS.md — running log · CLAUDE.md §Rules 1–4 — safety (in force)

## Maintenance
Update at each milestone / completed prompt. The **health** numbers are the
signal: falling vendor-leak and Prisma counts = progress; a rising ADR count =
ceremony creeping back; a package appearing = a harvest landed. Reconcile against
the live tree before committing each diff.
