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

import { MAX_GATE_DATA_BYTES, MAX_GATE_KEYS, decide, type GateDecision } from "./gate";
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
  /** Fixed-window admission shared by every isolate (see gate.ts). Optional: a hub without it simply cannot coordinate. */
  gate?(key: string, windowMs: number, limit: number): Promise<Omit<GateDecision, "source">>;
  gateRecord?(key: string, data: unknown): Promise<void>;
  /** One isolate at a time repairs a lost or expired reading; the rest wait for its result instead of each querying Neon. */
  claimRepair?(leaseMs: number): Promise<boolean>;
  releaseRepair?(): Promise<void>;
}

export interface HubStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

const KEY = "hub";
const GATE_PREFIX = "gate:";
const GATE_INDEX = "gate-index";
const REPAIR_KEY = "repair-until";
export const MAX_HUB_INSTALLATIONS = 51;

export class VersionHubCore implements HubClient {
  constructor(
    private readonly storage: HubStorage,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Every read-modify-write below runs one at a time. A Durable Object's input gate already gives that while it only awaits
   * its own storage; this makes the guarantee part of the logic, so the admission counts and the repair lease stay exact
   * under any storage implementation (the unit-test fake interleaves; so would an await on something else added later).
   */
  private tail: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async read(): Promise<HubReading | null> {
    const s = await this.storage.get<HubState>(KEY);
    return s ? { ids: s.ids, versions: s.versions, ageMs: this.now() - s.loadedAt } : null;
  }

  /** Merge a database reading in. Monotonic per counter, so a racing bump is never lost. */
  prime(ids: string[], versions: Record<string, Counter>): Promise<void> {
    return this.serial(() => this.primeNow(ids, versions));
  }
  private async primeNow(ids: string[], versions: Record<string, Counter>): Promise<void> {
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

  bump(installationId: string, patch: { rev?: number; sv?: number }): Promise<void> {
    return this.serial(() => this.bumpNow(installationId, patch));
  }
  private async bumpNow(installationId: string, patch: { rev?: number; sv?: number }): Promise<void> {
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
    if (next.rev > c.rev) await this.foldCommit(installationId, next.rev);
  }

  // ── shared admission (gate.ts) ────────────────────────────────────────────
  private async gateIndex(): Promise<string[]> {
    return (await this.storage.get<string[]>(GATE_INDEX)) ?? [];
  }

  gate(key: string, windowMs: number, limit: number): Promise<Omit<GateDecision, "source">> {
    return this.serial(() => this.gateNow(key, windowMs, limit));
  }
  private async gateNow(key: string, windowMs: number, limit: number): Promise<Omit<GateDecision, "source">> {
    if (typeof key !== "string" || key.length < 1 || key.length > 200 || !(windowMs >= 1000 && windowMs <= 3_600_000) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return { allow: false, retryAfterMs: 0, ageMs: 0 };
    }
    const k = GATE_PREFIX + key;
    const { entry, decision } = decide(await this.storage.get(k), this.now(), windowMs, limit);
    await this.storage.put(k, entry);
    const index = await this.gateIndex();
    const at = index.indexOf(key);
    if (at === -1 || at !== index.length - 1) {
      if (at >= 0) index.splice(at, 1);
      index.push(key);
      while (index.length > MAX_GATE_KEYS) await this.storage.delete(GATE_PREFIX + index.shift()!);
      await this.storage.put(GATE_INDEX, index);
    }
    return decision;
  }

  gateRecord(key: string, data: unknown): Promise<void> {
    return this.serial(() => this.gateRecordNow(key, data));
  }
  private async gateRecordNow(key: string, data: unknown): Promise<void> {
    const k = GATE_PREFIX + key;
    const e = await this.storage.get<{ w: number; n: number; data?: unknown }>(k);
    if (e && JSON.stringify(data).length <= MAX_GATE_DATA_BYTES) await this.storage.put(k, { ...e, data });
  }

  /** A structure commit raises every remembered check answer at once, so a cooldown answer served to any isolate cannot hide it. */
  private async foldCommit(installationId: string, rev: number): Promise<void> {
    for (const key of await this.gateIndex()) {
      if (!key.startsWith("check|")) continue;
      const e = await this.storage.get<{ w: number; n: number; data?: { at: number; revisions: Record<string, number> } }>(GATE_PREFIX + key);
      if (!e?.data?.revisions || (e.data.revisions[installationId] ?? 0) >= rev) continue;
      await this.storage.put(GATE_PREFIX + key, { ...e, data: { ...e.data, revisions: { ...e.data.revisions, [installationId]: rev } } });
    }
  }

  // ── repair lease ──────────────────────────────────────────────────────────
  claimRepair(leaseMs: number): Promise<boolean> {
    return this.serial(() => this.claimRepairNow(leaseMs));
  }
  private async claimRepairNow(leaseMs: number): Promise<boolean> {
    const now = this.now();
    const until = await this.storage.get<number>(REPAIR_KEY);
    if (until !== undefined && until > now) return false;
    await this.storage.put(REPAIR_KEY, now + Math.min(Math.max(leaseMs, 1000), 30_000));
    return true;
  }

  async releaseRepair(): Promise<void> {
    await this.storage.delete(REPAIR_KEY);
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
export const REPAIR_LEASE_MS = 10_000;
export const REPAIR_WAIT_MS = 150;
export const REPAIR_WAIT_TRIES = 4;

export function hubBackedRepo(inner: SyncRepo, hub: HubClient, maxAgeMs = HUB_MAX_AGE_MS, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): SyncRepo {
  const fromHub = (r: HubReading, ids: string[]) => new Map(ids.map((id) => [id, { revision: r.versions[id]!.rev, statusVersion: r.versions[id]!.sv }]));
  const usable = (r: HubReading | null, ids: string[]): r is HubReading => !!r && r.ageMs < maxAgeMs && ids.every((id) => r.versions[id]);
  return {
    ...inner,
    async versions(ids) {
      const r = await hub.read().catch(() => null);
      if (usable(r, ids)) return fromHub(r, ids);
      // Lost or expired reading. ONE isolate repairs it from the database; the others wait a bounded time for that result,
      // so K isolates cost one Neon read, not K. A hub that cannot grant the lease (or has no such method) changes nothing:
      // the caller repairs for itself, exactly as before.
      // Promise.resolve().then(): a stub whose method is missing or throws synchronously is "no lease service", not a failure.
      const lease = hub.claimRepair ? await Promise.resolve().then(() => hub.claimRepair!(REPAIR_LEASE_MS)).catch(() => true) : true;
      if (!lease) {
        for (let i = 0; i < REPAIR_WAIT_TRIES; i++) {
          await sleep(REPAIR_WAIT_MS);
          const again = await hub.read().catch(() => null);
          if (usable(again, ids)) return fromHub(again, ids);
        }
        // The repairing isolate did not finish in time (crashed, slow): read for ourselves rather than block indefinitely.
      }
      try {
        const fresh = await inner.versions(ids);
        const rec: Record<string, Counter> = {};
        for (const [id, v] of fresh) rec[id] = { rev: v.revision, sv: v.statusVersion };
        await hub.prime(ids, rec).catch(() => undefined); // best effort: failing to prime only costs a later database read
        return fresh;
      } finally {
        if (lease && hub.releaseRepair) await Promise.resolve().then(() => hub.releaseRepair!()).catch(() => undefined);
      }
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
