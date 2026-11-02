# Web navigation performance: /cpo/installations and /cpo/chargers — 2026-11-01

Written by Claude in VS Code (Sonnet) in E:\Claude\Straumvakt. Branch `codex/core-checkpoint-2026-10-31`, HEAD `51a6ea7`, working tree dirty before and after (154 entries at start). **Nothing was committed, pushed, deployed, or sent to Cloudflare/Neon/a charger.** Cloudflare was read only through a Wrangler `--dry-run` (no network deploy). Section of the larger core-completion task: web performance only. Mobile, lifecycle/financial recovery and OEM onboarding were not touched.

## Root cause (VERIFIED from source, then measured)

1. **Chargers page** ran its structural read twice. The server page read the registered list and Incoming, then `LiveStatusProvider` mounted and called the full `GET /api/cpo/sync` snapshot, which re-read every installation's tree (3 queries each cold) plus one device-state query per installation, only to look up a status badge by device id. It discarded all of it on unmount, so every visit repeated it. The server page also blocked first paint on the slower of the two server reads.
2. **Installations page** blocked first paint on a database read, was re-run on every Refresh/revisit past the 30 s router cache, and was mounted with `key={Date.now()}`, which threw away the expansion state and the view-local detail cache on each render. Each expansion read 5 queries, one of them 100 history rows nobody renders, and repeated after navigating away.
3. Each status poll without a VersionHub binding costs 2 queries (access + version probe), per open tab, every 30–120 s.
4. The 30 s client Refresh cooldown was client-only. Concurrent viewers each ran their own full reads.

A spinner or an extra cache over those paths would not have fixed 1 and 2.

## What changed

Server (existing endpoints; **no new route**, so the edge allow-list is untouched):
- `GET /api/cpo/sync?check=1` — revisions per installation with `checkedAt`, `ageMs`, `deferred`, `retryAfterMs`. Server-enforced 30 s cooldown per (permission scope, actor, visible set) in `ScopeChecker` (`src/lib/sync/check.ts`); concurrent probes share one load; a commit in the same isolate is folded in at once (`noteCommit`, called from `repoFor().save`). It never answers "unchanged"; the client compares numbers. Authorization (`access.visible`) runs on every call, so a revoked actor gets 403 before any remembered answer.
- `GET /api/cpo/sync?view=status` — lean device-state snapshot (one batched query, no structure) with ETag; concurrent reads for the same version state share one query.
- `GET /api/cpo/installations?view=chargers`, `?id=…&shape=tree` (no history/routing read), and `revisions` in the list response. Single-flight per permission scope.
- `permissionScopeKey/permissionPartition` in `actor.ts` — the one place that must differ between actors with different visible data when per-CPO accounts exist.
- `LiveRoom` disposes devices whose lease lapsed over 24 h ago, only when the room is at its 200-device cap; fresh or briefly quiet devices are never evicted.

Browser:
- `StructuralStore` (`src/lib/sync/structural-store.ts`, framework-free): one store per document, partitioned by session (`username:iat` from the layout), memory only, epoch-guarded against late responses, request de-duplication, bounded detail cache (50), expansion state kept, "Updates available" for changed/added installations, immediate disappearance of removed/revoked ones, 401/403 clears everything, `localMutation()` on the editor save and OEM import success paths.
- Both pages render a shell without database work; lists load through the store. `OverviewRefresh` shows the server-mirrored cooldown and "Updates available".
- Status provider uses the lean snapshot, keeps its client across navigation, resumes from its cursor, takes installation ids from the registered rows. The existing poller stays the fallback until push is proven.

## Measured (PGlite on the project's real migrations, real handlers, real `StructuralStore`)

Fixture: 20 installations × 3 circuits × 4 chargers = 80 chargers. Queries counted by SQL class; **`handlerMs` is handler CPU on an in-process database, not Neon latency, and is not reported as a speed result.** Baseline = unmodified code at the start of this task (`.tmp/perf/baseline.json`); after = `.tmp/perf/after.json` (`PERF=1 npx vitest run src/lib/perf/…`).

| Scenario | Before (requests / queries / connections) | After |
|---|---|---|
| Installations cold | 1 / 1 / 1 | 1 / **2** / 1 (list + revision stamp) |
| Installations warm revisit | 1 / 1 / 1 | **0 / 0 / 0** |
| First expansion | 1 / 5 (1 history) / 1 | 1 / 3 (0 history) / 1 |
| Re-expansion after navigating away | 1 / 5 / 1 | **0 / 0 / 0** |
| Chargers cold (page + status) | 2 / 84 / 3 | 3 / **6** / 3 |
| Chargers warm revisit | 2 / 24 / 3 | **0 / 0 / 0** |
| Unchanged check, no hub | n/a | 1 / 2 (access + version, 0 structural) / 1 |
| Unchanged check, fresh hub (in-process stand-in) | n/a | 1 / **0** / 1 |
| Check inside cooldown | n/a | 1 / 1 (access only; no probe) |
| Status poll, unchanged | 1 / 2 | 1 / 2 (0 with a hub) |
| Refresh, one installation changed + expanded | 3 / n/a | 3 / 7: check 2, list 2, detail 3 |
| 10 viewers open both pages at once | 10 snapshots / 280 queries | 30 requests / **25** queries (device-state read ×1, structure ×4) |

Cold installations does **one more** query than before and adds one HTTP round trip after the shell paints. It is not faster; it stops blocking the shell.

Rendered shell (production build, `next start`, **database deliberately unreachable**): `/cpo/installations` and `/cpo/chargers` return 200 in about 7–9 ms with the full navigation, titles, Refresh and "Loading…" state; anonymous requests get 307 (pages) and 401 (API). The data APIs then wait out the 10 s connection timeout and answer 500. The previous pages made first paint wait for that read (source: `db.ts` `connectionTimeoutMillis: 10_000`; **not measured** on the old build).

## Verification

- `tsc --noEmit`: pass. Full vitest: 195 files / 4,856 tests pass, 1 file skipped (the PERF-gated baseline). New: `structural-store.test.ts` (18), `check.test.ts`, `nav.perf.test.ts` (12, end-to-end below the browser), 3 room-disposal tests.
- `next build --webpack` (no database): pass. `opennextjs-cloudflare build --skipNextBuild` + `scripts/prepare-cpo-shell-assets.mjs` + `wrangler deploy --dry-run --config wrangler.cpo-shell.jsonc`: pass.
- Sign-in/out are form posts (`signin/page.tsx`, `cpo-sidebar.tsx`), not router navigations, so each starts a new document with an empty store.

## NOT verified / not done

- **No real browser or React rendering test.** The store and handlers are tested in Node; the React components compile, build and server-render their shell, but expansion, banner, countdown and Refresh behaviour were not exercised in a browser. There was no browser tooling in the session.
- **No DB-backed rendered page, no Neon latency, no network timings.** The old build was not run, so the pre-change rendered baseline is "not measured". The pre-patch (no router cache) baseline is also not measured.
- **VERSION_HUB is not bound** in the local `wrangler.cpo-shell.jsonc`; the 2026-10-31 facts file reported none on the live Workers (not re-checked today). Zero-query unchanged checks and push need that binding and a deploy; they are proven only against an in-process `VersionHubCore`. Without it each accepted check costs 2 small queries per actor per 30 s.
- **Cooldown and single-flight are per isolate.** Across isolates the bound is one probe per isolate per actor per cooldown. There is no distributed limiter. Refetches of lists/trees are protected by single-flight and the client gate, not a server-side rate limit.
- Incoming still reads the database (and the gateway presence RPC) on entry once its snapshot is over 30 s old. RPC counts were not exercised (no discoveries seeded).
- The full `GET /api/cpo/sync` snapshot used by mobile is unchanged, including its per-installation device query.
- **Phase 2 only partly done.** Done: lean status path, warm client, ids from the structural list, obsolete-device disposal. Not done or not re-tested here: placement/permission-change invalidation of live rooms end to end, bounded fanout verification, reconnect-snapshot and stale/offline behaviour beyond the existing tests, the swallowed-callback "lost final update" case. A removal UI that calls the lifecycle endpoint does not exist, so there is no client site to invalidate for removal.
- `npm run lint` cannot run (legacy `.eslintrc.json` with ESLint 9); not caused by this change. The sidebar's default `<Link>` prefetch was not checked at runtime (now moot: neither page does database work on render).
- Next's `staleTimes.dynamic: 30` is kept; it caches only shell payloads that hold no list data.

## Risks and follow-ups

- Existing `Repo` implementations gained `listChargers`, `revisions`, `getTree` (two test fakes updated).
- Recommended next steps: (1) approve and deploy the VERSION_HUB binding, then re-measure with real isolates; (2) a browser pass on the five behaviours above; (3) a distributed cooldown if abuse matters; (4) finish the Phase 2 invariants; (5) decide whether to batch structure reads in the full snapshot for mobile.
- Files: new `src/lib/sync/{check,single-flight,structural-store,structural-singleton}.ts`, `src/app/cpo/{structural-react,installations/installations-overview,chargers/chargers-overview}.tsx`, `src/lib/perf/*` (test-only harness). Modified: sync model/service/api/live/live-room/drizzle-sync-store, installations api/repo/drizzle-store/actor, both pages, layout, tree, refresh, live-status, grouped-table, editor/onboarding save paths. `.tmp/perf/` holds the JSON results and build logs.
