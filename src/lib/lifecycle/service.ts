// Charger lifecycle service: guarded removal/retirement, cancel, and return of a
// KNOWN device. Pure over ports; no SQL here, no effect without a durable record.
//
// Effects are ordered so that a failure at any point leaves a truthful, resumable
// state, never a false success:
//   1. request + block new starts (durable, atomic)            -> `requested`
//   2. stop each open session (command OUTSIDE the db tx; result recorded)
//   3. wait for the durable StopTransaction (the only confirmation)
//   4. close placement + identity in ONE tx that re-checks "no open sessions"
//   5. settle each session through the retained costing consumer
// Repeating a request with the same key, or for a device that already has an open
// request, RESUMES that request instead of creating a second effect.

import { OPEN_STATES, type LifecycleKind, type LifecycleRequest, type SessionStep, type StopOutcome } from "./model";
import { planNext, type Observed } from "./plan";

/** Thrown by the port when a session is open at close time. Not a failure: the placement simply stays open. */
export class SessionOpenError extends Error {
  constructor() { super("session open"); }
}
/**
 * Thrown by the port when a concurrent request won a uniqueness race (one open request per device, or the
 * request key). PostgreSQL aborts the failed transaction, so the caller must NOT re-read inside it: the
 * service rolls back, then resumes in a NEW transaction after re-authorising.
 */
export class OpenRequestConflict extends Error {
  constructor() { super("open request conflict"); }
}
/** Thrown inside the transaction when another worker advanced the request first: undoes every effect of this attempt. */
class LostRace extends Error {}

export type ActorRef = { kind: "shared_login"; label: string };

export type DeviceView = { deviceId: string; placementId: string; orgId: string; installationId: string; circuitId: string | null; label: string; chargePointId: string };

export interface LifecycleTx {
  /** The device's CURRENT open placement, or null if it is not placed. */
  currentPlacement(deviceId: string): Promise<DeviceView | null>;
  byKey(requestKey: string): Promise<LifecycleRequest | null>;
  byId(id: string): Promise<LifecycleRequest | null>;
  openFor(deviceId: string): Promise<LifecycleRequest | null>;
  insert(req: LifecycleRequest, requestKey: string): Promise<void>;
  /**
   * Row-locks this placement (FOR UPDATE) until the transaction ends. Every decision "is a session open / may one
   * start / may the placement close" is made AFTER acquiring this lock, so it serialises with a start that holds
   * the same row FOR SHARE. Lock order everywhere: installation, then placement.
   */
  lockPlacement(placementId: string): Promise<void>;
  /** Optimistic: false if `expectedVersion` no longer matches (another worker advanced it). */
  save(req: LifecycleRequest, expectedVersion: number): Promise<boolean>;
  /** Sessions that are open, plus those already tracked by the request. */
  observed(req: Pick<LifecycleRequest, "deviceId" | "sessions">): Promise<Observed>;
  openSessionCount(deviceId: string): Promise<number>;
  /** Closes placement + connection identity, bumps the installation revision, writes the history row. Throws if a session is open. */
  closePlacement(input: { req: LifecycleRequest; at: Date }): Promise<void>;
  /** Detached devices whose most recent placement was in this installation. */
  detachedHere(installationId: string): Promise<{ deviceId: string; label: string; vendor: string | null; model: string | null; lastCircuitId: string | null; retired: boolean }[]>;
  deviceHistory(deviceId: string): Promise<{ orgId: string; installationId: string; retired: boolean } | null>;
  openPlacement(input: { deviceId: string; orgId: string; installationId: string; circuitId: string; label: string; chargePointId: string; actor: ActorRef; at: Date }): Promise<void>;
}
export interface LifecycleStore {
  run<T>(fn: (tx: LifecycleTx) => Promise<T>): Promise<T>;
}
export interface StopPort {
  requestStop(i: { deviceId: string; transactionNo: number; requestId: string }): Promise<StopOutcome>;
}
export interface CostingPort {
  runFor(transactionId: string): Promise<void>;
}

export type Deps = {
  store: LifecycleStore;
  /** null = no stop command path exists: removal of a device with an open session is UNAVAILABLE. */
  stop: StopPort | null;
  costing: CostingPort | null;
  authorise: (actor: ActorRef, orgId: string, action: "remove" | "retire" | "return") => boolean;
  now: () => Date;
  newId?: () => string;
};

export type Refusal = "not_found" | "forbidden" | "reason_required" | "stop_unavailable" | "conflict" | "placed_elsewhere" | "not_detached" | "retired_needs_return" | "identity_in_use" | "bad_request";
export type Result<T> = { ok: true; value: T } | { ok: false; refusal: Refusal; message: string };
const refuse = (refusal: Refusal, message: string): Result<never> => ({ ok: false, refusal, message });

export type Preview = { deviceId: string; label: string; installationId: string; openSessions: number; willBlockNewStarts: true; steps: string[]; unavailable: string | null };

export async function previewRemoval(deps: Deps, input: { deviceId: string; actor: ActorRef }): Promise<Result<Preview>> {
  return deps.store.run(async (tx) => {
    const d = await tx.currentPlacement(input.deviceId);
    if (!d || !deps.authorise(input.actor, d.orgId, "remove")) return refuse("not_found", "Charger not found");
    const open = await tx.openSessionCount(d.deviceId);
    const unavailable = open > 0 && !deps.stop ? "This charger has a session in progress and the stop command is not available yet, so it cannot be removed safely." : null;
    return {
      ok: true as const,
      value: {
        deviceId: d.deviceId, label: d.label, installationId: d.installationId, openSessions: open, willBlockNewStarts: true as const, unavailable,
        steps: [
          "New starts on this charger are blocked immediately.",
          ...(open > 0 ? [`${open} session(s) in progress will be stopped and settled with the driver; removal stays PENDING until each stop is confirmed.`] : []),
          "The placement and connection identity are then closed; the device record and all history are kept.",
          ...(open > 0 ? ["Settlement uses the session's measured energy and the terms that applied; missing evidence is held visibly, never priced as zero."] : []),
        ],
      },
    };
  });
}

export async function requestRemoval(
  deps: Deps,
  input: { deviceId: string; kind: LifecycleKind; reason: string; requestKey: string; actor: ActorRef },
): Promise<Result<LifecycleRequest>> {
  const reason = input.reason.trim();
  if (input.kind === "retire" && reason.length < 3) return refuse("reason_required", "Retirement needs a reason.");
  const now = deps.now();
  /** Resume an existing request ONLY if it is the same operation and the caller may see it. */
  const resume = (existing: LifecycleRequest): Result<LifecycleRequest> => {
    // Another organisation's request is indistinguishable from none.
    if (!deps.authorise(input.actor, existing.orgId, input.kind)) return refuse("not_found", "Charger not found");
    // A reused key for another charger, or an open request of a different kind, is a conflicting payload: never "success".
    if (existing.deviceId !== input.deviceId) return refuse("conflict", "That request key was already used for a different operation.");
    if (existing.kind !== input.kind) return refuse("conflict", `A ${existing.kind} request for this charger is already open; finish or cancel it first.`);
    return { ok: true, value: existing };
  };
  const attempt = () => deps.store.run(async (tx) => {
    // Same key, or an operation already open for this device: RESUME it, never duplicate effects.
    const existing = (await tx.byKey(input.requestKey)) ?? (await tx.openFor(input.deviceId));
    if (existing) return resume(existing);

    const d = await tx.currentPlacement(input.deviceId);
    // Not placed, or not the caller's: indistinguishable on purpose (no tenant leakage).
    if (!d || !deps.authorise(input.actor, d.orgId, input.kind)) return refuse("not_found", "Charger not found");

    // Serialise with a start that holds this placement FOR SHARE: observe sessions only AFTER the lock.
    await tx.lockPlacement(d.placementId);
    const seen = await tx.observed({ deviceId: d.deviceId, sessions: [] });
    const open = seen.sessions.filter((s) => s.stoppedReceivedAt === null);
    if (open.length > 0 && !deps.stop) return refuse("stop_unavailable", "A session is in progress and the stop command path is not available; removal is unavailable until it can actually stop the session.");

    const steps: SessionStep[] = seen.sessions.map((s) => ({
      transactionNo: s.transactionNo, transactionId: s.transactionId,
      stop: { attempts: 0, lastOutcome: null, lastAt: null, everAccepted: false },
      stopConfirmedAt: s.stoppedReceivedAt ? s.stoppedReceivedAt.toISOString() : null,
      ...(s.superseded && !s.stoppedReceivedAt ? { superseded: true } : {}),
      settlement: { state: "pending", reason: null },
    }));
    const req: LifecycleRequest = {
      id: (deps.newId ?? (() => crypto.randomUUID()))(), kind: input.kind, state: "requested", orgId: d.orgId, installationId: d.installationId,
      deviceId: d.deviceId, placementId: d.placementId, reason: reason || "removed from installation", actorKind: input.actor.kind, actorLabel: input.actor.label,
      requestedAt: now.toISOString(), serviceEndedAt: null, completedAt: null, sessions: steps, attention: null, identityClosed: false, version: 1,
    };
    await tx.insert(req, input.requestKey); // existence of this open row IS the block on new starts (read by the engine)
    return { ok: true as const, value: req };
  });
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof OpenRequestConflict)) throw e; // any other failure (including other constraints) is NOT turned into success
    // The failed transaction was rolled back. In a NEW one: re-authorise and return the winner, or surface the original error.
    return deps.store.run(async (tx) => {
      const winner = (await tx.byKey(input.requestKey)) ?? (await tx.openFor(input.deviceId));
      if (!winner) throw e; // the violation was not the race we know about
      return resume(winner);
    });
  }
}

/** Advances ONE step toward completion. Safe to call repeatedly and concurrently. */
export async function progressRemoval(deps: Deps, requestId: string): Promise<Result<LifecycleRequest>> {
  const now = deps.now();
  // 1. read + plan
  const snap = await deps.store.run(async (tx) => {
    const req = await tx.byId(requestId);
    if (!req) return null;
    const seen = await tx.observed(req);
    return { req, plan: planNext(req, seen, now) };
  });
  if (!snap) return refuse("not_found", "Request not found");
  const { req, plan } = snap;
  if (!OPEN_STATES.includes(req.state)) return { ok: true, value: req };

  // 2. effects outside the database transaction; results are recorded, not assumed
  const stopResults = new Map<number, StopOutcome>();
  for (const a of plan.actions) {
    if (a.type === "request_stop") {
      stopResults.set(a.transactionNo, deps.stop ? await deps.stop.requestStop({ deviceId: req.deviceId, transactionNo: a.transactionNo, requestId: req.id }).catch((): StopOutcome => "unavailable") : "unavailable");
    } else if (a.type === "run_costing" && deps.costing) {
      await deps.costing.runFor(a.transactionId).catch(() => undefined); // failure leaves the session pending/held visibly
    }
  }

  // 3. record outcomes and (if due) close, atomically, re-checking the world
  try {
    return await advanceInTx(deps, req, plan, stopResults, now);
  } catch (e) {
    if (!(e instanceof LostRace)) throw e;
    // Another worker advanced the request first and this attempt's effects were rolled back: resume from their result.
    const cur = await deps.store.run((tx) => tx.byId(requestId));
    return cur ? { ok: true as const, value: cur } : refuse("not_found", "Request not found");
  }
}

async function advanceInTx(deps: Deps, req: LifecycleRequest, plan: ReturnType<typeof planNext>, stopResults: Map<number, StopOutcome>, now: Date): Promise<Result<LifecycleRequest>> {
  const requestId = req.id;
  return deps.store.run(async (tx) => {
    const cur = await tx.byId(requestId);
    if (!cur) return refuse("not_found", "Request not found");
    if (cur.version !== req.version) return { ok: true as const, value: cur }; // another worker advanced it; resume from there

    const seen = await tx.observed(cur);
    const sessions: SessionStep[] = cur.sessions.map((s) => {
      const r = stopResults.get(s.transactionNo);
      return r ? { ...s, stop: { attempts: s.stop.attempts + 1, lastOutcome: r, lastAt: now.toISOString(), everAccepted: s.stop.everAccepted || r === "accepted" } } : s;
    });
    const merged: LifecycleRequest = { ...cur, sessions };
    let after = planNext(merged, seen, now);

    if (plan.actions.some((a) => a.type === "close_placement") && after.state === "closing") {
      // Re-check INSIDE the transaction that nothing started in the meantime.
      if ((await tx.openSessionCount(cur.deviceId)) === 0) {
        try {
          await tx.closePlacement({ req: merged, at: now });
          merged.identityClosed = true;
          merged.serviceEndedAt = now.toISOString();
          after = planNext(merged, { ...seen, placementOpen: false }, now);
        } catch (e) {
          if (!(e instanceof SessionOpenError)) throw e; // a session slipped in: leave the placement open and re-plan next step
        }
      }
    }
    const next: LifecycleRequest = {
      ...merged, state: after.state, sessions: after.sessions, attention: after.attention,
      completedAt: after.state === "completed" ? now.toISOString() : null, version: cur.version + 1,
    };
    // Optimistic claim AFTER the effects but INSIDE the same transaction: losing it throws, which rolls the effects back.
    if (!(await tx.save(next, cur.version))) throw new LostRace();
    return { ok: true as const, value: next };
  });
}

export async function cancelRemoval(deps: Deps, input: { requestId: string; actor: ActorRef }): Promise<Result<LifecycleRequest>> {
  return deps.store.run(async (tx) => {
    const req = await tx.byId(input.requestId);
    if (!req || !deps.authorise(input.actor, req.orgId, req.kind)) return refuse("not_found", "Request not found");
    if (!OPEN_STATES.includes(req.state)) return refuse("conflict", `Request is already ${req.state}.`);
    if (req.state === "closing" || req.state === "settling") return refuse("conflict", "The placement is already being closed; it cannot be undone from here (use return to service).");
    if (req.sessions.some((s) => s.stop.everAccepted || s.stopConfirmedAt)) return refuse("conflict", "A session is already being stopped; the removal can no longer be cancelled.");
    const next = { ...req, state: "cancelled" as const, version: req.version + 1 };
    return (await tx.save(next, req.version)) ? { ok: true as const, value: next } : refuse("conflict", "The request changed; reload.");
  });
}

/** Known detached devices that may be returned here. Scope-safe: only devices last placed in THIS installation. */
export async function listReturnable(deps: Deps, input: { installationId: string; orgId: string; actor: ActorRef }) {
  if (!deps.authorise(input.actor, input.orgId, "return")) return [];
  return deps.store.run((tx) => tx.detachedHere(input.installationId));
}

/** Return a KNOWN device to its own installation and circuit. Never creates a device; never transfers. */
export async function returnDevice(
  deps: Deps,
  input: { deviceId: string; installationId: string; orgId: string; circuitId: string; label: string; chargePointId: string; confirmRetiredReturn?: boolean; actor: ActorRef },
): Promise<Result<{ deviceId: string }>> {
  if (!deps.authorise(input.actor, input.orgId, "return")) return refuse("not_found", "Charger not found");
  const at = deps.now();
  return deps.store.run(async (tx) => {
    if (await tx.currentPlacement(input.deviceId)) return refuse("placed_elsewhere", "That charger is placed. Ordinary return does not move a placed charger; use an authorised transfer.");
    const hist = await tx.deviceHistory(input.deviceId);
    // Unknown here == unknown: do not reveal that the device exists for another organisation.
    if (!hist || hist.orgId !== input.orgId || hist.installationId !== input.installationId) return refuse("not_found", "Charger not found");
    if (hist.retired && !input.confirmRetiredReturn) return refuse("retired_needs_return", "This charger was retired. Return to service must be explicit, and nothing from before is reactivated automatically.");
    if (await tx.openFor(input.deviceId)) return refuse("conflict", "A removal for this charger is still open.");
    try {
      await tx.openPlacement({ deviceId: input.deviceId, orgId: input.orgId, installationId: input.installationId, circuitId: input.circuitId, label: input.label, chargePointId: input.chargePointId, actor: input.actor, at });
    } catch (e) {
      if (e instanceof Error && e.message === "identity_in_use") return refuse("identity_in_use", "That connection ID is in use by another device.");
      throw e;
    }
    return { ok: true as const, value: { deviceId: input.deviceId } };
  });
}
