// TEST-ONLY in-memory LifecycleStore. Models atomic run/rollback and the one
// optimistic version check. It proves service logic only; SQL locks, exclusion
// constraints and partial unique indexes are NOT exercised.

import type { LifecycleRequest } from "../model";
import { OpenRequestConflict, PlacementAlreadyClosed, SessionOpenError, type ActorRef, type DeviceView, type LifecycleStore, type LifecycleTx } from "../service";
import type { Observed, ObservedSession } from "../plan";

type Tx = { transactionNo: number; transactionId: string; deviceId: string; stoppedReceivedAt: Date | null; authorized: boolean; costingState: string; superseded?: boolean };
type Hist = { orgId: string; installationId: string; retired: boolean };
export type World = {
  recoveryCursor: string | null;
  placements: Map<string, DeviceView>; // deviceId -> OPEN placement
  history: Map<string, Hist>;
  txs: Tx[];
  requests: Map<string, { req: LifecycleRequest; key: string }>;
  closed: { deviceId: string; at: Date; requestId: string }[];
  opened: { deviceId: string; chargePointId: string }[];
  identitiesInUse: Set<string>;
  revisionBumps: number;
};

/**
 * `serialize: true` runs transactions one at a time (a stronger isolation than READ COMMITTED). The default lets
 * them interleave, which suits the optimistic-version tests but whose snapshot rollback is NOT safe against
 * another concurrent commit: use `serialize` whenever a test needs a rollback beside concurrent winners.
 */
export function memoryLifecycle(init: Partial<World> = {}, opts: { serialize?: boolean } = {}) {
  let chain: Promise<unknown> = Promise.resolve();
  let w: World = {
    recoveryCursor: null, placements: new Map(), history: new Map(), txs: [], requests: new Map(), closed: [], opened: [], identitiesInUse: new Set(), revisionBumps: 0, ...init,
  };
  const hooks = {
    failCloseOnce: false,
    beforeClose: null as null | (() => void),
    /** Simulates losing the uniqueness race: the next insert throws, and this competitor is committed AFTER the rollback. */
    raceOnInsert: null as null | LifecycleRequest,
    log: [] as string[],
  };

  const store: LifecycleStore = {
    run(fn) {
      if (!opts.serialize) return runOnce(fn);
      const next = chain.then(() => runOnce(fn), () => runOnce(fn));
      chain = next.catch(() => undefined);
      return next;
    },
  };
  async function runOnce<T>(fn: (tx: LifecycleTx) => Promise<T>): Promise<T> {
    {
      const snap = structuredClone({ ...w, requests: [...w.requests], placements: [...w.placements], history: [...w.history], identitiesInUse: [...w.identitiesInUse] });
      const tx: LifecycleTx = {
        async currentPlacement(id) { return w.placements.get(id) ?? null; },
        async byKey(key) { return [...w.requests.values()].find((r) => r.key === key)?.req ?? null; },
        async byId(id) { return w.requests.get(id)?.req ?? null; },
        async openFor(deviceId) { return [...w.requests.values()].map((r) => r.req).find((r) => r.deviceId === deviceId && !["completed", "cancelled"].includes(r.state)) ?? null; },
        async insert(req, key) {
          if (hooks.raceOnInsert) throw new OpenRequestConflict();
          if ([...w.requests.values()].some((r) => r.key === key)) throw new OpenRequestConflict();
          if ([...w.requests.values()].some((r) => r.req.deviceId === req.deviceId && !["completed", "cancelled"].includes(r.req.state))) throw new OpenRequestConflict();
          w.requests.set(req.id, { req: structuredClone(req), key });
        },
        async lockPlacement(id) { hooks.log.push(`lock:${id}`); },
        async save(req, expected) {
          const cur = w.requests.get(req.id);
          if (!cur || cur.req.version !== expected) return false;
          w.requests.set(req.id, { ...cur, req: structuredClone(req) });
          return true;
        },
        async observed(req): Promise<Observed> {
          hooks.log.push("observe");
          const tracked = new Set(req.sessions.map((s) => s.transactionNo));
          const sessions: ObservedSession[] = w.txs.filter((t) => t.deviceId === req.deviceId && (t.stoppedReceivedAt === null || tracked.has(t.transactionNo))).map((t) => ({ ...t }));
          return { sessions, placementOpen: w.placements.has(req.deviceId) };
        },
        async lockRecoveryCursor() { return w.recoveryCursor; },
        async advanceRecoveryCursor(afterDeviceId) { w.recoveryCursor = afterDeviceId; },
        async listOpen({ limit, afterDeviceId }) {
          return [...w.requests.values()].map((r) => structuredClone(r.req))
            .filter((r) => !["completed", "cancelled"].includes(r.state) && (afterDeviceId === null || r.deviceId > afterDeviceId))
            .sort((a, b) => a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0).slice(0, limit);
        },
        async observedMany(reqs) {
          hooks.log.push("observeMany");
          const out = new Map<string, Observed>();
          for (const req of reqs) {
            const tracked = new Set(req.sessions.map((s) => s.transactionNo));
            out.set(req.id, { sessions: w.txs.filter((t) => t.deviceId === req.deviceId && (t.stoppedReceivedAt === null || tracked.has(t.transactionNo))).map((t) => ({ ...t })), placementOpen: w.placements.has(req.deviceId) });
          }
          return out;
        },
        async openSessionCount(deviceId) { return w.txs.filter((t) => t.deviceId === deviceId && t.stoppedReceivedAt === null).length; },
        async closePlacement({ req, at }) {
          hooks.beforeClose?.();
          if (hooks.failCloseOnce) { hooks.failCloseOnce = false; throw new Error("close failed"); }
          if (w.txs.some((t) => t.deviceId === req.deviceId && t.stoppedReceivedAt === null)) throw new SessionOpenError();
          if (!w.placements.has(req.deviceId)) throw new PlacementAlreadyClosed(); // closed by another worker while this one waited on the lock
          w.placements.delete(req.deviceId);
          w.closed.push({ deviceId: req.deviceId, at, requestId: req.id });
          w.revisionBumps++;
          const h = w.history.get(req.deviceId);
          if (h) h.retired = req.kind === "retire";
        },
        async detachedHere(installationId) {
          return [...w.history.entries()].filter(([id, h]) => h.installationId === installationId && !w.placements.has(id)).map(([deviceId, h]) => ({ deviceId, label: `Device ${deviceId.slice(0, 4)}`, vendor: null, model: null, lastCircuitId: null, retired: h.retired }));
        },
        async deviceHistory(id) { return w.history.get(id) ?? null; },
        async openPlacement(i) {
          if (w.identitiesInUse.has(i.chargePointId)) throw new Error("identity_in_use");
          w.placements.set(i.deviceId, { deviceId: i.deviceId, placementId: `p-${w.opened.length + 100}`, orgId: i.orgId, installationId: i.installationId, circuitId: i.circuitId, label: i.label, chargePointId: i.chargePointId });
          w.opened.push({ deviceId: i.deviceId, chargePointId: i.chargePointId });
        },
      };
      try {
        return await fn(tx);
      } catch (e) {
        w = { ...snap, requests: new Map(snap.requests), placements: new Map(snap.placements), history: new Map(snap.history), identitiesInUse: new Set(snap.identitiesInUse) } as World;
        if (hooks.raceOnInsert) { const c = hooks.raceOnInsert; hooks.raceOnInsert = null; w.requests.set(c.id, { req: structuredClone(c), key: `winner-${c.id}` }); }
        throw e;
      }
    }
  }
  return { store, hooks, get w() { return w; }, set w(v: World) { w = v; } };
}

export const ACTOR: ActorRef = { kind: "shared_login", label: 'shared login "Straumvakt"' };
