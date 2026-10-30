# First charger release readiness — 2026-10-30 17:33 UTC

## Decision

Not ready for live charging deployment. This is a targeted readiness check, not a full review or hardware test. Do not infer that the existing Neon database is the authorized migration target from this inventory.

## Current checkout

- `E:\Claude\Straumvakt`, remote `andri187/Straumvakt`, branch `fix/drizzle-unique-constraints-2026-10-26`, HEAD `15c036f7de0d7b8c948d6cc64fef757b7d79935f`, one worktree; extensive prior tracked and untracked changes. No source changes, commits or Git publication in this check.
- The lifecycle handoff remains partial: editor not wired, driver/token enrolment absent, terms/payer version retention not sealed, and installation closure and cross-installation transfer not implemented. SQL, Workers runtime and charger behavior were not verified.

## Read-only infrastructure inventory

- Cloudflare account specified in `wrangler.cpo-shell.jsonc`: Worker scripts inventory returned only `straumvakt-cpo-shell`. Its live settings list assets, shell credentials, app name and rate limiter, but no `DATABASE_URL`, `ENGINE`, `GATEWAY`, or `VERSION_HUB` binding. No gateway Worker was listed in this account. Other accounts and any non-Worker gateway are not established by this check. Do not recreate retired infrastructure by assumption.
- Neon connector listed one project `Straumvakt` (`silent-thunder-69180957`), with one default/primary branch `development` (`br-broad-boat-zaftlmic`), database `neondb`, owner `neondb_owner`, and one read/write endpoint currently idle with 300-second suspend timeout. Pooler is reported disabled. These are control-plane observations, not evidence of schema contents, data isolation, application connection, or target approval. No SQL was run and no credentials retrieved.
- No cloud, database, secret, hardware or deployment changes were made.

## Local verification

- `node scripts/check-adopted-schema.mjs`: passed, seven migrations, chain intact, no drift, additive; does not execute SQL.
- `npx vitest run src/lib/lifecycle src/lib/ocpp-engine src/lib/costing src/lib/installations scripts/cpo-shell-edge.test.mjs scripts/cpo-shell-engine.test.mjs`: 14 files, 239 tests passed. Gateway `npx vitest run`: 11 files, 219 passed. These use local doubles. Both initially failed before collecting tests because Vite could not rename temporary files in sandbox temp; rerunning with TEMP and TMP set to separate workspace `.tmp` directories succeeded.
- `npx tsc --noEmit` in root and `gateway`: passed.
- `npm run build` with `DATABASE_URL` and `DIRECT_URL` empty and telemetry disabled: compilation, TypeScript and static-page generation passed, but build failed collecting traces with EPERM creating `.next/standalone/node_modules/next/dist/build/webpack/config/blocks`. `.env.local` was loaded; no credential values printed. Full Next build, OpenNext packaging and Workers dry-run remain unverified. Build generated local `.next` artifacts; no deploy command run.

## First controlled journey and outstanding work

1. Fix the start/removal concurrency risk described below, then review session terms/payer retention and removal/settlement; wire a minimal operator journey and driver/token enrolment. A held or unconfirmed stop must remain visible and never be treated as successful settlement.
2. Determine the approved existing database target and a safe way to execute and test migrations 0000–0006 and concurrency behavior. Target identity and cost/isolation must be established before a write; a metadata listing is insufficient.
3. Resolve the absent gateway and shell database/service bindings with an explicit release configuration, confirm routing and deployment identity, complete a production build and runtime validation. Any provisioning or release is a separate external action.
4. On controlled equipment or an independent simulator, create an installation and charger, enrol a test identity, demonstrate permitted/refused charging, stop and inspect durable evidence and test cost. Then remove during a session, verify charger-confirmed stop, settlement and historical terms, and return the same device. Hardware operation requires its own scoped authorization.

## Source review: start and removal can overlap (2026-10-30)

**Inferred release blocker; requires a real PostgreSQL concurrency reproduction.** `handleStartTransaction` reads `startBlocked` before inserting a transaction; `startBlocked` queries open lifecycle requests without taking a shared lock. `requestRemoval` separately reads open sessions before inserting its request. Neither path, as currently written, serializes those two decisions. Thus a start can observe no open removal while a removal simultaneously observes no open start; both can commit. `closePlacement` locks the installation before counting open sessions, but the start path does not take that same lock before its check and insertion, so that lock alone does not establish mutual exclusion. A stale admitted socket after closure also needs explicit consideration. The existing memory-store tests do not reproduce actual PostgreSQL isolation/interleavings.

Before the guarded removal is exposed or a charger is admitted, choose a shared serialization boundary and consistent lock order for start, removal request, and closure; revalidate the current placement/identity inside that boundary; preserve evidence for a refused start; and test both orders and a start racing closure with separate database connections. Also test that retries and concurrent request keys remain idempotent. No fix or database reproduction has yet been performed.

**Review update 18:12 UTC:** Opus's independent [review](2026-10-30-1757-opus-charger-lifecycle-review.md) confirms overlapping start/request reads but argues that `planNext`'s fresh observation covers the slipped start. That can happen when the start commits before a later observation; it does not itself demonstrate safety if the start has already read `startBlocked`, remains uncommitted while removal observes no session and closes the placement, and commits afterwards. The installation lock in closure is not acquired by the start writer. Treat this interleaving and stale sockets as unresolved until independently reproduced or ruled out, and do not presume an installation-wide lock is the right fix. Opus also identified likely stale-session removal deadlock and concurrent duplicate-request errors; its proposed automatic abandoned classification must not itself assert physical stop or settle without evidence.

Clarification on terms: costing selects records using the session's start time, and output lines capture price and payer at calculation; the concern is that it queries mutable current database rows after the session, so later in-place edits or backdating can affect the first calculation and references alone may not preserve the applied inputs. A durable snapshot or enforceable version history with appropriate capture time requires review.

## ChatGPT Review Handoff

Objective: establish readiness for the first controlled charging journey and live release. Implementation: read-only Cloudflare/Neon control-plane inspection and local checks; this report is the only intended repository change. Starting/ending HEAD unchanged; checkout remains dirty and uncommitted. Architecture unchanged. Tests and limits are above; the build failed due to a filesystem permission error, not an established application defect. Infrastructure observations are time-specific. Risks include no listed gateway, missing live shell database binding, unverified SQL/runtime/hardware, unfinished onboarding and lifecycle UI, and unsealed terms. Next: resolve the concrete missing workflow and package/build validation before preparing a target-specific deployment.
