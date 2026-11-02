// BASELINE of the existing navigation path, measured on the unmodified code. Gated: `PERF=1 npx vitest run src/lib/perf/baseline.perf.test.ts`.
// Writes .tmp/perf/baseline.json. The page loaders are reproduced call-for-call from the page sources named in each scenario;
// the handlers (handleInstallations, handleSync) are the real ones.

import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseUnavailableError, handleInstallations, type ApiDeps } from "@/lib/installations/api";
import { mayAdminister, sharedLoginActor, type Actor } from "@/lib/installations/actor";
import { listChargers } from "@/lib/installations/drizzle-store";
import { repoFor } from "@/lib/installations/repo";
import { handleSync, type SyncApiDeps } from "@/lib/sync/api";
import { StructureCache } from "@/lib/sync/cache";
import { drizzleSharedLoginAccess, drizzleSyncRepo } from "@/lib/sync/drizzle-sync-store";
import { ORIGIN, SHELL_CONFIG, SHELL_ENV, makeFixture, measure, sessionCookie, changeStatus, type Fixture, type Measurement } from "./harness";

let fx: Fixture;
const results: Measurement[] = [];
const actor = sharedLoginActor(SHELL_CONFIG.username);

const apiDeps = (): ApiDeps => ({
  env: SHELL_ENV,
  contextOrgId: fx.orgId,
  async withRepo(fn) {
    fx.counter.connections += 1;
    return fn(repoFor(fx.db));
  },
});
// The composition used by liveSyncDeps without a VERSION_HUB binding (src/lib/sync/live.ts:40-56), with a caller-owned isolate cache.
const syncDeps = (cache: StructureCache): SyncApiDeps => ({
  env: SHELL_ENV,
  async withSync(fn) {
    fx.counter.connections += 1;
    return fn({ access: drizzleSharedLoginAccess<Actor>(fx.db, (a) => mayAdminister(a, "")), repo: drizzleSyncRepo(fx.db), cache, now: Date.now });
  },
});
const get = async (path: string, deps: ApiDeps | SyncApiDeps, h: (r: Request, d: never) => Promise<Response>, headers: Record<string, string> = {}) =>
  h(new Request(`${ORIGIN}${path}`, { headers: { cookie: await sessionCookie(), ...headers } }), deps as never);

// src/app/cpo/installations/page.tsx:140 -> deps.withRepo((r) => r.list(50, 0))
const installationsPageLoad = () => apiDeps().withRepo((r) => r.list(50, 0));
// src/app/cpo/chargers/page.tsx:41 (listIncoming, own connection) and :48-52 (openDb + listChargers, second connection), run concurrently
const chargersPageLoad = () => Promise.all([
  apiDeps().withRepo((r) => r.listIncoming(fx.orgId, actor)),
  (async () => { fx.counter.connections += 1; return listChargers(fx.db, { limit: 100, offset: 0 }); })(),
]);

beforeAll(async () => { fx = await makeFixture(); }, 180_000);
afterAll(async () => {
  mkdirSync(".tmp/perf", { recursive: true });
  writeFileSync(".tmp/perf/baseline.json", JSON.stringify({ fixture: fx.size, installations: fx.installationIds.length, note: "PGlite in-process; counts are the evidence, handlerMs is handler CPU not network", results }, null, 2));
  await fx.close();
});

describe.skipIf(!process.env.PERF)("baseline: existing installations/chargers navigation path", () => {
  it("installations page", async () => {
    results.push(await measure(fx, "installations: cold page load (server list)", 1, installationsPageLoad));
    results.push(await measure(fx, "installations: warm revisit after router-cache expiry / Refresh (server list again)", 1, installationsPageLoad));
    const api = apiDeps();
    const ids = fx.installationIds;
    results.push(await measure(fx, "installations: first expansion of one installation (GET ?id=)", 1, async () => { const r = await get(`/api/cpo/installations?id=${ids[0]}`, api, handleInstallations as never); expect(r.status).toBe(200); }));
    results.push(await measure(fx, "installations: first expansion of 5 installations", 5, async () => { for (const id of ids.slice(1, 6)) await get(`/api/cpo/installations?id=${id}`, api, handleInstallations as never); }));
    results.push(await measure(fx, "installations: re-expansion after navigating away and back (view-local loader was disposed)", 1, async () => { await get(`/api/cpo/installations?id=${ids[0]}`, api, handleInstallations as never); }));
  });

  it("chargers page", async () => {
    results.push(await measure(fx, "chargers: cold page load (server: incoming + registered list)", 1, chargersPageLoad, "gateway presence RPCs not exercised: no discoveries seeded"));
    const cache = new StructureCache();
    const sd = syncDeps(cache);
    let cursor = "";
    results.push(await measure(fx, "chargers: LiveStatusProvider mount, cold isolate (GET /api/cpo/sync snapshot)", 1, async () => { const r = await get("/api/cpo/sync", sd, handleSync as never); cursor = ((await r.json()) as { cursor: string }).cursor; }));
    results.push(await measure(fx, "chargers: LiveStatusProvider mount, warm isolate cache (snapshot again)", 1, async () => { await get("/api/cpo/sync", sd, handleSync as never); }));
    results.push(await measure(fx, "chargers: one unchanged poll (GET ?since=cursor, no hub)", 1, async () => { await get(`/api/cpo/sync?since=${cursor}`, sd, handleSync as never); }));
    await changeStatus(fx, fx.installationIds[0]!);
    results.push(await measure(fx, "chargers: one poll with a status change", 1, async () => { await get(`/api/cpo/sync?since=${cursor}`, sd, handleSync as never); }));
    results.push(await measure(fx, "chargers: full warm revisit = page load + provider remount snapshot", 2, async () => { await chargersPageLoad(); await get("/api/cpo/sync", sd, handleSync as never); }));
  });

  it("concurrent viewers on a cold isolate", async () => {
    const K = 10;
    results.push(await measure(fx, `chargers: ${K} viewers open the page at once, empty isolate cache (${K} snapshots)`, K, async () => {
      const cache = new StructureCache();
      const sd = syncDeps(cache);
      await Promise.all(Array.from({ length: K }, () => get("/api/cpo/sync", sd, handleSync as never)));
    }));
    expect(results.length).toBeGreaterThan(0);
    void DatabaseUnavailableError;
  });
});
