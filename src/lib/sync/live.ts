// Live dependency construction for the sync endpoint and the writers' hub
// notifications. One short-lived database client per request; the hub is
// optional: with no `VERSION_HUB` binding everything still works and simply
// reads the database for the version probe (more database requests, same answers).

import { mayAdminister, type Actor } from "@/lib/installations/actor";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { openDb, readDatabaseUrl, type ShellDbEnv } from "@/lib/installations/db";
import { StructureCache } from "./cache";
import { drizzleSharedLoginAccess, drizzleSyncRepo } from "./drizzle-sync-store";
import { hubBackedAccess, hubBackedRepo, type HubClient } from "./hub";
import type { SyncApiDeps } from "./api";

/** The one hub instance name. Per-CPO sharding is a later change; a name per organisation fits the same interface. */
export const HUB_INSTANCE = "shell";

type HubStub = { read: HubClient["read"]; prime: HubClient["prime"]; bump: HubClient["bump"]; invalidate: HubClient["invalidate"] };
export type HubNamespace = { idFromName(name: string): unknown; get(id: unknown): HubStub };

export function hubFromNamespace(ns: HubNamespace | undefined | null): HubClient | null {
  if (!ns) return null;
  const stub = () => ns.get(ns.idFromName(HUB_INSTANCE));
  return {
    read: () => stub().read(),
    prime: (ids, v) => stub().prime(ids, v),
    bump: (id, p) => stub().bump(id, p),
    invalidate: () => stub().invalidate(),
  };
}

/** Per-isolate structure cache. Correctness never depends on it (see cache.ts); it only saves tree reads. */
const isolateCache = new StructureCache();

export type SyncBindings = { VERSION_HUB?: HubNamespace; CPO_SHELL_REALTIME_ENABLED?: string };

export function liveSyncDeps(env: ShellDbEnv, bindings: SyncBindings = {}, now: () => number = Date.now): SyncApiDeps {
  const hub = hubFromNamespace(bindings.VERSION_HUB);
  return {
    env: { ...env, CPO_SHELL_REALTIME_ENABLED: hub && (bindings.CPO_SHELL_REALTIME_ENABLED ?? env.CPO_SHELL_REALTIME_ENABLED) === "true" ? "true" : "false" },
    async withSync(fn) {
      const url = readDatabaseUrl(env);
      if (!url) throw new DatabaseUnavailableError();
      const { db, close } = openDb(url);
      try {
        const access = drizzleSharedLoginAccess<Actor>(db, (a) => mayAdminister(a, ""));
        const repo = drizzleSyncRepo(db);
        return await fn({
          access: hub ? hubBackedAccess(access, hub, (a) => mayAdminister(a, "")) : access,
          repo: hub ? hubBackedRepo(repo, hub) : repo,
          cache: isolateCache,
          now,
        });
      } finally {
        await close();
      }
    },
  };
}
