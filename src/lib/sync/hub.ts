// Cross-instance version hub (Checkpoint D completion).
//
// PROBLEM: a per-isolate cache plus a database version probe saves tree reads but
// still wakes the database on every UI request, from every isolate.
//
// MECHANISM: one small Durable Object ("the hub") holds, for the shell, only the
// NON-SECRET counters the delta service already probes for: the visible
// installation ids and each one's `{revision, statusVersion}`. It is not a second
// source of truth and holds no entity data, no verifier, no token, no permission.
//
//   - WRITE-THROUGH: after a structure save commits, and after a CHANGED device
//     status commits, the writer tells the hub the new counter. `bump` is
//     monotonic (max), so late or duplicate notifications cannot move a counter
//     backwards, and a lost notification can only make the hub OLDER, never wrong.
//   - READ: an unchanged poll is answered from the hub with NO database query.
//   - RECOVERY: every entry carries `loadedAt`; past `maxAgeMs` the decorators go
//     to the database, re-prime the hub, and carry on. A missed bump therefore
//     delays visibility by at most `maxAgeMs`, an explicit and reported bound.
//   - ACCESS: the hub never answers "may this actor see this?". The decorator
//     below applies the platform-operator policy (a pure function of the signed
//     session, no database) and only then asks the hub which installations exist.
//     With per-CPO accounts, `AccessPort.visible` is database-backed and is NOT
//     decorated: revocation is never traded for a saved query.
//
// The Durable Object class (workers/cpo-shell-hub.mjs) is a thin wrapper over
// `VersionHubCore`, so the logic below is the logic that runs there. Creating the
// binding is a deployment step and is not done here.

import type { AccessPort, SyncRepo } from "./service";

export type Counter = { rev: number; sv: number };
export type HubState = { ids: string[]; versions: Record<string, Counter>; loadedAt: number };
export type HubReading = { ids: string[]; versions: Record<string, Counter>; ageMs: number };

/** What a caller needs from the hub, whether it is the real stub or the in-process core. */
export interface HubClient {
  read(): Promise<HubReading | null>;
  prime(ids: string[], versions: Record<string, Counter>): Promise<void>;
  bump(installationId: string, patch: { rev?: number; sv?: number }): Promise<void>;
  invalidate(): Promise<void>;
}

export interface HubStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

const KEY = "hub";
export const MAX_HUB_INSTALLATIONS = 51;

export class VersionHubCore implements HubClient {
  constructor(
    private readonly storage: HubStorage,
    private readonly now: () => number = Date.now,
  ) {}

  async read(): Promise<HubReading | null> {
    const s = await this.storage.get<HubState>(KEY);
    return s ? { ids: s.ids, versions: s.versions, ageMs: this.now() - s.loadedAt } : null;
  }

  /** Merge a database reading in. Monotonic per counter, so a racing bump is never lost. */
  async prime(ids: string[], versions: Record<string, Counter>): Promise<void> {
    if (ids.length > MAX_HUB_INSTALLATIONS) return; // an over-large scope is refused upstream; do not store it
    const cur = await this.storage.get<HubState>(KEY);
    const merged: Record<string, Counter> = {};
    for (const id of ids) {
      const a = versions[id];
      const b = cur?.versions[id];
      if (a || b) merged[id] = { rev: Math.max(a?.rev ?? 0, b?.rev ?? 0), sv: Math.max(a?.sv ?? 0, b?.sv ?? 0) };
    }
    await this.storage.put(KEY, { ids: [...ids].sort(), versions: merged, loadedAt: this.now() } satisfies HubState);
  }

  async bump(installationId: string, patch: { rev?: number; sv?: number }): Promise<void> {
    const cur = await this.storage.get<HubState>(KEY);
    if (!cur) return; // nothing primed yet: the next read goes to the database, which is already current
    const c = cur.versions[installationId] ?? { rev: 0, sv: 0 };
    const next = { rev: Math.max(c.rev, patch.rev ?? 0), sv: Math.max(c.sv, patch.sv ?? 0) };
    // A bump for an installation the hub does not list means the LIST is stale (new installation): force a refresh.
    if (!cur.ids.includes(installationId)) {
      await this.storage.put(KEY, { ...cur, loadedAt: 0 } satisfies HubState);
      return;
    }
    if (next.rev === c.rev && next.sv === c.sv) return; // duplicate: no write
    await this.storage.put(KEY, { ...cur, versions: { ...cur.versions, [installationId]: next } } satisfies HubState);
  }

  async invalidate(): Promise<void> {
    await this.storage.delete(KEY);
  }
}

export const HUB_MAX_AGE_MS = 120_000;

/** Access decorator: platform-operator policy from the session, installation LIST from the hub when fresh. */
export function hubBackedAccess<Actor>(inner: AccessPort<Actor>, hub: HubClient, mayAdminister: (a: Actor) => boolean, maxAgeMs = HUB_MAX_AGE_MS): AccessPort<Actor> {
  return {
    async visible(actor) {
      if (!mayAdminister(actor)) return null; // no session-level permission: never consult the hub
      const r = await hub.read().catch(() => null);
      if (r && r.ageMs < maxAgeMs) return { installationIds: r.ids };
      return inner.visible(actor); // database; versions() below re-primes
    },
  };
}

/** Repo decorator: answer `versions` from the hub when every requested id is fresh; otherwise the database, then re-prime. */
export function hubBackedRepo(inner: SyncRepo, hub: HubClient, maxAgeMs = HUB_MAX_AGE_MS): SyncRepo {
  return {
    ...inner,
    async versions(ids) {
      const r = await hub.read().catch(() => null);
      if (r && r.ageMs < maxAgeMs && ids.every((id) => r.versions[id])) {
        return new Map(ids.map((id) => [id, { revision: r.versions[id]!.rev, statusVersion: r.versions[id]!.sv }]));
      }
      const fresh = await inner.versions(ids);
      const rec: Record<string, Counter> = {};
      for (const [id, v] of fresh) rec[id] = { rev: v.revision, sv: v.statusVersion };
      await hub.prime(ids, rec).catch(() => undefined); // best effort: failing to prime only costs a later database read
      return fresh;
    },
  };
}

/** Called by writers AFTER commit. Never throws: a failed notification is recovered by the age bound. */
export async function notifyCommitted(hub: HubClient | null | undefined, installationId: string, patch: { rev?: number; sv?: number }): Promise<boolean> {
  if (!hub) return false;
  try {
    await hub.bump(installationId, patch);
    return true;
  } catch {
    return false;
  }
}
