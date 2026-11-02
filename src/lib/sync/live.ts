// Live dependency construction for the sync endpoint and the writers' hub
// notifications. One short-lived database client per request; the hub is
// optional: with no `VERSION_HUB` binding everything still works and simply
// reads the database for the version probe (more database requests, same answers).

import { mayAdminister, type Actor } from "@/lib/installations/actor";
import { DatabaseUnavailableError } from "@/lib/installations/api";
import { openDb, readDatabaseUrl, type ShellDbEnv } from "@/lib/installations/db";
import { StructureCache } from "./cache";
import { isolateChecker } from "./check";
import { hubBackedGate, isolateGate } from "./gate";
import { isolateFlight } from "./single-flight";
import { drizzleSharedLoginAccess, drizzleSyncRepo } from "./drizzle-sync-store";
import { hubBackedAccess, hubBackedRepo, type HubClient } from "./hub";
import type { SyncApiDeps } from "./api";

/** The one hub instance name. Per-CPO sharding is a later change; a name per organisation fits the same interface. */
export const HUB_INSTANCE = "shell";

type HubStub = {
  read: HubClient["read"]; prime: HubClient["prime"]; bump: HubClient["bump"]; invalidate: HubClient["invalidate"];
  gate: NonNullable<HubClient["gate"]>; gateRecord: NonNullable<HubClient["gateRecord"]>;
  claimRepair: NonNullable<HubClient["claimRepair"]>; releaseRepair: NonNullable<HubClient["releaseRepair"]>;
};
export type HubNamespace = { idFromName(name: string): unknown; get(id: unknown): HubStub };

export function hubFromNamespace(ns: HubNamespace | undefined | null): HubClient | null {
  if (!ns) return null;
  const stub = () => ns.get(ns.idFromName(HUB_INSTANCE));
  return {
    read: () => stub().read(),
    prime: (ids, v) => stub().prime(ids, v),
    bump: (id, p) => stub().bump(id, p),
    invalidate: () => stub().invalidate(),
    // Against a hub class deployed before these methods existed they reject ("does not implement"); every caller treats a
    // rejection as "no coordination" and falls back to its isolate-local bound, so an older hub is never a failure.
    gate: (key, windowMs, limit) => stub().gate(key, windowMs, limit),
    gateRecord: (key, data) => stub().gateRecord(key, data),
    claimRepair: (leaseMs) => stub().claimRepair(leaseMs),
    releaseRepair: () => stub().releaseRepair(),
  };
}

/**
 * Writer-side notifications to the per-installation live room (the same VersionHub class, instance `live:<installationId>`).
 * Called AFTER a commit and best effort: the room also disposes obsolete devices on its own, and clients render devices from
 * the structural list, so a lost notification delays removal of a stale value but never exposes anything.
 */
export type LiveRoomsClient = {
  /** The authoritative device ids of the installation after a structure commit. */
  reconcile(installationId: string, deviceIds: string[]): Promise<void>;
  /** A placement closed: drop the device and refuse its old placement. */
  remove(installationId: string, deviceId: string, placementId: string): Promise<void>;
};
type RoomStub = { reconcileLive(installationId: string, deviceIds: string[]): Promise<unknown>; removeLive(installationId: string, deviceId: string, placementId: string): Promise<unknown> };
export function liveRoomsFromNamespace(ns: { idFromName(name: string): unknown; get(id: unknown): unknown } | undefined | null): LiveRoomsClient | null {
  if (!ns) return null;
  const room = (installationId: string) => ns.get(ns.idFromName(`live:${installationId.toLowerCase()}`)) as RoomStub;
  return {
    async reconcile(installationId, deviceIds) { await room(installationId).reconcileLive(installationId.toLowerCase(), deviceIds); },
    async remove(installationId, deviceId, placementId) { await room(installationId).removeLive(installationId.toLowerCase(), deviceId, placementId); },
  };
}

/** Per-isolate structure cache. Correctness never depends on it (see cache.ts); it only saves tree reads. */
const isolateCache = new StructureCache();

export type SyncBindings = { VERSION_HUB?: HubNamespace; CPO_SHELL_REALTIME_ENABLED?: string };

export function liveSyncDeps(env: ShellDbEnv, bindings: SyncBindings = {}, now: () => number = Date.now): SyncApiDeps {
  const hub = hubFromNamespace(bindings.VERSION_HUB);
  return {
    env: { ...env, CPO_SHELL_REALTIME_ENABLED: hub && (bindings.CPO_SHELL_REALTIME_ENABLED ?? env.CPO_SHELL_REALTIME_ENABLED) === "true" ? "true" : "false" },
    checker: isolateChecker,
    gate: hubBackedGate(hub, isolateGate),
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
          flight: isolateFlight,
        });
      } finally {
        await close();
      }
    },
  };
}
