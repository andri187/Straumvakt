# WORKSPACE.md — Straumvakt structural snapshot

## Stage A release — 2026-11-02

Commit `a0a4930` is pushed to `origin/codex/core-checkpoint-2026-10-31`. The approved gateway and shell packages are live as versions `d1d4fc7f-3f85-4cc4-8175-eb23e299a65b` and `0503225a-4130-43a5-920b-015c5d13a5f4` respectively. Realtime, recovery, hub binding and migrations remain off/unapplied. See `docs/agent-runs/2026-11-02/2026-11-02-stage-a-release.md` for checks and remaining gaps.

## Remaining-core structure — 2026-11-02

New local structure from the remaining-core completion (not deployed): `src/lib/sync/{gate,live-fanout,driver-live}.ts` (shared admission, role-scoped live fanout, driver grant), the live room's removal reconcile and placement tombstones, `gateway/src/engine-client.ts` batch compatibility fallback, `CommandEntrypoint.requestStopV1`, migration `apps/api/drizzle/0011_driver_open_session_index.sql`, Flutter `apps/mobile/lib/live/live_client.dart`, and test-only tooling in `tools/browser-rig/`, `tools/release-checks/` and the opt-in real-PostgreSQL suite `src/lib/pg-concurrency/`. Evidence and release manifest: `docs/agent-runs/2026-11-01/2026-11-01-remaining-core-completion-handoff.md`.

## Local archive checkpoint — 2026-10-31

Selected Straumvakt material formerly in Documents\New project and the complete
Documents\Straumvakt-preservation-backups folder now live under
`archive/local-documents-2026-10-30/` in this canonical checkout. 41,279 files
(1.69 GiB) moved with SHA-256 verification; selected originals removed. The
archive is local-only, ignored by Git and excluded from product builds; old
instructions within it are historical evidence. Unrelated Documents files remain.
See `docs/notes/2026-10-31-documents-consolidation.md` and the archive mapping.
This checkpoint does not supersede newer runtime evidence in TASKS/handoffs.

## Current checkpoint — 2026-10-29

- **Latest source/coordination checkpoint, 23:22 UTC:** canonical remote verified
  `https://github.com/andri187/Straumvakt`, branch
  `fix/drizzle-unique-constraints-2026-10-26`, HEAD
  `15c036f7de0d7b8c948d6cc64fef757b7d79935f`; 71 short-status entries before
  this new prompt was added. Installation-management source is handed off (Sonnet's
  report), not deployed or independently persistence-verified. Codex previously
  confirmed the live installations page still shows the disabled shell control.
  The generic engine + scoped cache/delta task is now queued for Sonnet, awaiting
  Andri's "Got mail" dispatch; see TASKS.md and the named prompt. Source remains
  dirty and no commit, cloud/database change or hardware action was performed
  while preparing it. The older 19:24 checkpoint below describes pre-implementation
  state and is retained as history, not the current installation implementation.

- **Installation-management task prepared and queued for Sonnet:**
  [assignment](docs/agent-prompts/2026-10-29-s1-live-installation-management.md).
  Real persisted one-page electrical tree and charger registration first;
  cleaned existing OCPP engine integration afterwards. Shared account audit,
  separate electrician contact/review, no test database and no local-only product.
  Exact database/cloud release operations still need the scoped execution step.
- **Read-only source check, 19:24 UTC:** branch
  `fix/drizzle-unique-constraints-2026-10-26`, HEAD `15c036f7de0d7b8c948d6cc64fef757b7d79935f`,
  one permanent worktree, 61 pre-existing short-status entries preserved.
  Installation routes/repositories still use Prisma; placement code is Drizzle.
  The shell has no database binding in its config and currently blocks other API
  paths. Existing gateway routing does not accept the proposed installation URL.
  These are source findings, not newly verified cloud state.
- No code, database, cloud or charger operations were performed to prepare the
  assignment. Only prompt/mail and coordination records changed. Sonnet execution
  is unconfirmed; Opus has an update, not a new coding assignment.

## Published shell checkpoint — 2026-10-27 (historical)

- **Approved shell now published (23:30 UTC):** version
  `48223d86-3254-4e42-9e5f-a7c55148b4b1` of `straumvakt-cpo-shell` serves the
  car homepage and flat CPO navigation at www. The apex domain is attached to
  this same Worker with a 308 redirect to HTTPS www. Existing login secrets and
  limiter retained; no database binding or Neon access. 91 focused tests,
  typecheck/build/package/dry-run, local Worker smoke and live navigation/logout
  checks passed. Mobile keyboard navigation corrected and verified live.
  [Release evidence](docs/agent-runs/2026-10-27/2026-10-27-2332-approved-shell-release.md).
  This supersedes the earlier visual-correction-outstanding checkpoint below.

- **Subsequent design checkpoint:** Andri accepted the original car-artwork
  homepage and flat S1 CPO navigation as the presentation direction. Clickable
  local subpages use explicitly labelled synthetic records, without backend
  connections. Integrating this design with the authenticated shell remains
  outstanding; no deployment was made during the design walkthrough.
- **Approved presentation integrated locally (2026-10-27 23:30 UTC, not
  deployed):** `/signin` carries the original car-artwork homepage over the
  existing server-side login; `/cpo` has the flat left navigation and routes
  `/cpo`, `/people`, `/installations`, `/chargers`, `/sessions`, `/costs`,
  `/agreements`, `/settings` (`/cpo/organisations` redirects to settings). Pages
  are honestly unconnected. Public assets are exactly the car AVIF/WebP, logo
  icon and `/icon.svg`, kept in sync across `cpo-shell-policy.ts`,
  `workers/cpo-shell-edge.mjs` and the pruner. See
  `docs/agent-runs/2026-10-27/2026-10-27-2330-approved-homepage-flat-shell-handoff.md`.
- Published the bounded CPO shell to `https://www.straumvakt.org` after Andri
  explicitly requested that target. Worker `straumvakt-cpo-shell`, account
  `1b2fc4c163e8544e9cd472baa5a19c74`; final deployment after secret provisioning:
  `05df9bed-fe80-4247-a376-90b4045bba49`. Source config is
  `wrangler.cpo-shell.jsonc`; root legacy Wrangler config was not deployed.
- The shell has static assets, a login rate-limit binding and server-only test
  credentials. No database, OCPP, queue, scheduled task or other backend binding
  was provisioned. Assets pass the edge allowlist; 90 excluded generated assets
  were pruned, with source designs retained. 55 focused tests and the OpenNext
  package/dry run passed; live correct/incorrect login, protected pages, logout
  and excluded legacy URLs checked successfully. No Git commit or push.
- **Visual result rejected by Andri:** this publication uses the wrong shell.
  The intended original console has an expandable left navigation tree and
  meaningful CPMS categories, preserved under
  `archive/straumvakt-org-console-2026-08-08/`. Correcting that presentation
  remains outstanding; successful login/deployment does not approve the design.
- Subsequent read-only Neon metadata check: only project
  `silent-thunder-69180957`; endpoint `ep-red-pine-zasodu3y` is idle,
  suspended since `2026-10-27T00:15:16Z`, last active `00:09:55Z`, min 0.25 /
  max 1 CU with 300-second suspension. No SQL or compute start was used.
- Andri reports $29.08 organisation spend against a $25 email-notification
  threshold. Exact billing attribution is **UNVERIFIED**: connector lacks billing
  line items and the accessible browser requires console login. Do not equate
  accumulated organisation charges with current project burn or zero compute
  activity with zero overall charges. Cost constraint now recorded in CLAUDE.md
  and SOW; historical forecast needs reconciliation before use as a budget.

## Current cloud checkpoint — 2026-10-26 23:57 UTC

- Andri explicitly approved legacy runtime retirement and deletion of old
  charger, driver, session, site and evidence data. Local source, UI designs,
  research and project documents are retained.
- **VERIFIED deleted:** all four Cloudflare Workers, two Pages projects and
  their custom-domain records, six queues, the Hyperdrive configuration, and
  the gateway Durable Object namespace. Worker/domain/route inventories are
  empty. The public applications and OCPP endpoint are deliberately offline.
  Domain registration and four email DNS records are retained.
- **VERIFIED deleted:** Neon project `spring-leaf-73019190`, including all four
  branches and the production-cloned `clean-slate` branch.
- **Only current Neon project:** `silent-thunder-69180957` (Straumvakt), fresh
  PostgreSQL 17 project in `aws-eu-west-2`; branch `development`
  (`br-broad-boat-zaftlmic`), endpoint `ep-red-pine-zasodu3y`. Compute verified
  idle, min 0.25 / max 1 CU, five-minute idle suspension. No application schema,
  seed or runtime connection has been installed. Old connection strings and
  resource IDs in local configs/docs are retired references, not valid targets.
- **VERIFIED deleted:** R2 evidence bucket and all 365,645 objects; Fly app
  `straumvakt-zaptec-consumer-staging` and its stopped machine. Final bucket
  and Fly app inventories are empty. GitHub's remote Zaptec deployment workflow
  is disabled (verified in the signed-in browser at 23:55 UTC); its local guard
  is also prepared but uncommitted/unpushed. The approved runtime/data cleanup
  is complete; accrued charges and account subscriptions are not erased.
- Execution details follow the proposal in
  [the cloud review](docs/agent-runs/2026-10-26/2026-10-26-2339-cloudflare-neon-read-only-review.md).
  No application deployment, schema migration, commit or push accompanied
  this cleanup. Recheck this checkpoint before any database test or deployment.

## Earlier source checkpoint — 2026-10-26 18:07 UTC

- **VERIFIED Git:** canonical checkout `E:\Claude\Straumvakt`, branch
  `fix/drizzle-unique-constraints-2026-10-26`, HEAD `15c036f7de0d7b8c948d6cc64fef757b7d79935f`.
  The local remote-tracking ref for that branch resolves to the same SHA. This
  does not by itself verify a fresh fetch from GitHub.
- **VERIFIED source:** Drizzle is the active schema authority. The four commits
  from `1dad103` through `15c036f` restore 13 field-level unique constraints,
  replace Drizzle migrations 0000–0008 with `0000_cold_hex.sql`, add
  `scripts/seed.mts` and `npm run db:seed`, rename cost-factor codes, and add
  `unique-constraints.test.ts` plus the scaffolder fix. `apps/api/drizzle.old/`
  remains untracked. Legacy Prisma scripts and packages still exist; do not
  interpret them as the current schema-authoring path.
- **VERIFIED static finding, 2026-10-26 19:18 UTC:** the new
  `apps/api/drizzle/0000_cold_hex.sql` omits all 11 named hand-written
  constraints from the former migrations 0005–0007 and their `btree_gist`
  extension. These include temporal non-overlap, nonempty-period, and OCPP
  status checks; Drizzle snapshots cannot express the hand-written parts.
  `node scripts/check-schema-consistency.mjs` passes at 85 tables and 1,038
  columns, but that check compares only tables and columns. The cold migration
  must be reconciled and tested on an expressly approved disposable target
  before any database application. This finding does not establish the state
  of any existing Neon database.
- **UNKNOWN:** current route-by-route Prisma retirement percentage. The 21%
  figure below was measured on 2026-08-08 and is historical. Successful
  deployment of the new cold baseline, current Neon branch contents, and
  current Cloudflare deployment state are **NOT VERIFIED** here.
- **Working tree at this checkpoint:** this instruction cleanup modifies
  `CLAUDE.md`, `FOCUS.md`, `DECISIONS.md`, and
  `docs/agent-prompts/latest.md`. Pre-existing changes in
  `docs/reference/README.md` and four untracked paths were preserved. Run
  `git status --short` for the exact live state; this snapshot is not a lock.
- **Verification for this documentation update:** read-only Git log/status and
  source-file inspection; `git diff --check` passed. No application test,
  database command, deploy, push, or external mutation was run for this update.

The structural inventory and measurements below are the **2026-08-08 baseline**.
Reconcile each number against current source before using it as a present-day
claim or updating it at a later milestone.

Purpose: a lightweight, **diffable** description of the workspace. Update it at
each milestone; `git diff` it to see and discuss structural drift. Prose is kept
minimal on purpose — the diff should read clean. This is a map, not a manual;
the active rules live in FOCUS.md.

Snapshot: 2026-08-08 · **reconciled against the live tree** (was: seed estimates).
Health numbers below are MEASURED, not estimated. Three seed lines were wrong —
see `## Seed corrections` at the bottom.

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
- `packages/contracts` — canonical vocab · adapter interface · money-line shape — `live` (shell spine; 29 modules + 2 new)
- `packages/db` — **does not exist yet.** Schema SoT is `packages/shared/src/db/` (8 modules) — `parked` until a harvest needs it
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
- Schema owner: Drizzle — `packages/shared/src/db/` (8 modules, 66 tables). Prisma mirrors still present: **2** (`prisma/`, `apps/api/prisma/`, 9 files each)
- Migration flow: `db:generate:sql` → review → test → dev → staging → prod (each gated)
- `drizzle-kit push`: **banned**

## Boundaries & health  (the diffable heartbeat)
- Domain order: `commercial → charging → protocol → assets → identity`
- Absolutes: vendor at the edge · platform is a leaf · catalog free to import
- depcruise baseline: **24** (22 vendor · 1 cycle · 1 identity→higher) — target → **0** ✅ measured
- `packages/`: **3** — shared (`harvesting`) · contracts (`live`) · commercial (`home-only`) → target +db, +core
- `apps/`: api · mobile · zaptec-consumer · (gateway standalone, outside workspaces)
- ADRs: **51**, all 51 bannered legacy ✅ done; active canon = FOCUS.md  ← rising count = ceremony returning
- Prisma: **481** calls → 0 · Drizzle **131** · **~21% ported** ✅ measured. Mirrors **2** → 0.

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

---

## Seed corrections  *(reconciled 2026-08-08)*

Three seed lines described the plan rather than the tree. Recorded so the next
diff is trusted:

| seed said | reality | why it mattered |
|---|---|---|
| `packages/db` — `forming` | **does not exist.** The Drizzle schema is `packages/shared/src/db/` (8 modules, 66 tables) | A reader would have looked for a package that was never created. ADR 0051 gave Drizzle schema ownership; it did not create a package for it. |
| `packages/`: **1** (shared) | **3** — shared · contracts · commercial | contracts landed and commercial was created as an empty home on 2026-08-08 |
| Prisma: ~**500** calls "at ADR 0051" | **481** calls, **131** Drizzle, **~21% ported** | The ~500 was the figure at the time ADR 0051 was written. It has moved since, and the Drizzle side was not counted at all — so the seed showed a migration with no visible progress. |

Confirmed correct as seeded: depcruise baseline **24** (22 vendor · 1 cycle ·
1 identity→higher); **51** ADRs; Prisma mirrors **2**.
