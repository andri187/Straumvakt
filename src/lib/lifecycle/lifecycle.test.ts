import { beforeEach, describe, expect, it } from "vitest";
import { MAX_STOP_ATTEMPTS, STOP_ATTEMPT_WINDOW_MS, STOP_BACKOFF_MS, TRANSITIONS } from "./model";
import { OpenRequestConflict, cancelRemoval, listReturnable, previewRemoval, progressRemoval, requestRemoval, returnDevice, selectDueRemovals, type CostingPort, type Deps, type StopPort } from "./service";
import { ACTOR, memoryLifecycle } from "./__tests__/memory-store";
import type { StopOutcome } from "./model";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T0 = new Date("2026-10-30T10:00:00Z");

let clock: Date;
let world: ReturnType<typeof memoryLifecycle>;
let stopOutcome: StopOutcome;
let stopCalls: { transactionNo: number }[];
let stopInputs: Parameters<StopPort["requestStop"]>[0][];
let costingCalls: string[];
let stop: StopPort | null;

const costing: CostingPort = {
  async runFor(id) {
    costingCalls.push(id);
    const t = world.w.txs.find((x) => x.transactionId === id)!;
    if (t.costingState === "needed") t.costingState = "costed";
  },
};
const deps = (over: Partial<Deps> = {}): Deps => ({
  store: world.store, stop, costing, now: () => clock, newId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
  authorise: (_a, orgId) => orgId === ORG, ...over,
});

beforeEach(() => {
  clock = new Date(T0);
  stopOutcome = "accepted";
  stopCalls = [];
  costingCalls = [];
  stopInputs = [];
  stop = { requestStop: async (i) => { stopCalls.push({ transactionNo: i.transactionNo }); stopInputs.push(i); return stopOutcome; } };
  world = memoryLifecycle();
  world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
  world.w.history.set(DEV, { orgId: ORG, installationId: INST, retired: false });
});

const startSession = (no = 7, over: Partial<(typeof world.w.txs)[number]> = {}) =>
  world.w.txs.push({ transactionNo: no, transactionId: `tx-${no}`, deviceId: DEV, stoppedReceivedAt: null, authorized: true, costingState: "not_needed", ...over });
const stopSession = (no = 7, costingState = "needed") => {
  const t = world.w.txs.find((x) => x.transactionNo === no)!;
  t.stoppedReceivedAt = new Date(clock);
  t.costingState = costingState;
};
const remove = (over: Record<string, unknown> = {}) => requestRemoval(deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR, ...over } as never);
const advance = async (id: string, dt = 0) => { clock = new Date(clock.getTime() + dt); const r = await progressRemoval(deps(), id); if (!r.ok) throw new Error(r.message); return r.value; };

describe("remove with no session", () => {
  it("blocks starts at once, closes the placement, keeps the device and every history row, and completes", async () => {
    const r = await remove();
    expect(r).toMatchObject({ ok: true, value: { state: "requested", reason: "removed from installation", actorLabel: ACTOR.label } });
    const id = (r as { value: { id: string } }).value.id;
    expect(world.w.placements.has(DEV)).toBe(true); // nothing closed by the request itself
    const cur = await advance(id); // nothing to stop: evaluate and close in one step
    expect(cur).toMatchObject({ state: "completed", identityClosed: true });
    expect(cur.serviceEndedAt).toBe(clock.toISOString());
    expect(world.w.placements.has(DEV)).toBe(false);
    expect(world.w.history.has(DEV)).toBe(true); // device + history kept
    expect(world.w.closed).toHaveLength(1);
    expect(world.w.revisionBumps).toBe(1);
  });
  it("retirement needs a reason; removal does not", async () => {
    expect(await remove({ kind: "retire", reason: " " })).toMatchObject({ ok: false, refusal: "reason_required" });
    expect(await remove({ kind: "retire", reason: "end of life", requestKey: "k2" })).toMatchObject({ ok: true });
  });
});

describe("deleting a charger with an active session", () => {
  it("is UNAVAILABLE (nothing written) while no stop command path exists, never a silent detach", async () => {
    startSession();
    stop = null;
    const r = await remove();
    expect(r).toMatchObject({ ok: false, refusal: "stop_unavailable" });
    expect(world.w.requests.size).toBe(0);
    expect(world.w.placements.has(DEV)).toBe(true);
    expect(await previewRemoval(deps({ stop: null }), { deviceId: DEV, actor: ACTOR })).toMatchObject({ ok: true, value: { openSessions: 1, unavailable: expect.stringContaining("cannot be removed safely") } });
  });
  it("initiates a stop; an ACCEPTED command is not a stopped session; removal stays pending until the durable stop arrives", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    let cur = await advance(id);
    expect(stopCalls).toHaveLength(1);
    expect(cur).toMatchObject({ state: "stopping", sessions: [{ stop: { attempts: 1, lastOutcome: "accepted", everAccepted: true }, stopConfirmedAt: null }] });
    for (let i = 0; i < 3; i++) cur = await advance(id, 1000); // within backoff: no second command, still not closed
    expect(cur.state).toBe("stopping");
    expect(world.w.placements.has(DEV)).toBe(true);
    expect(world.w.closed).toHaveLength(0);
  });
  it("closes only after the durable StopTransaction, then settles; the deletion cannot complete early", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    stopSession(7, "needed"); // the charger's StopTransaction arrives (engine wrote it)
    let cur = await advance(id, 11_000); // confirmed stop -> close in this step
    expect(cur.state).toBe("settling"); // placement closed; settlement still pending
    expect(cur.completedAt).toBeNull();
    expect(cur.sessions[0]!.settlement.state).toBe("pending");
    cur = await advance(id); // costing runs and decides
    expect(costingCalls).toEqual(["tx-7"]);
    expect(cur).toMatchObject({ state: "completed", sessions: [{ settlement: { state: "settled" } }] });
    // repeating after completion changes nothing and settles nothing twice
    await advance(id); await advance(id);
    expect(costingCalls).toEqual(["tx-7"]);
    expect(world.w.closed).toHaveLength(1);
  });
  it("missing or bad evidence HOLDS the settlement visibly: removal completes, the amount is never invented", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    stopSession(7, "blocked_energy");
    await advance(id, 11_000);
    const cur = await advance(id);
    expect(cur).toMatchObject({ state: "completed", sessions: [{ settlement: { state: "held", reason: "blocked_energy" } }] });
    expect(costingCalls).toEqual([]); // nothing priced
  });
  it("unauthorized energy is evidence, not settled use", async () => {
    startSession(7, { authorized: false });
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    stopSession(7, "excluded_unauthorized");
    await advance(id, 11_000);
    expect(await advance(id)).toMatchObject({ state: "completed", sessions: [{ settlement: { state: "not_applicable" } }] });
  });
  it("a refused/offline/timed-out stop is retried with backoff, then needs attention: never reported as stopped or abandoned", async () => {
    startSession();
    stopOutcome = "offline";
    const id = ((await remove()) as { value: { id: string } }).value.id;
    let cur = await advance(id);
    for (let i = 0; i < MAX_STOP_ATTEMPTS; i++) cur = await advance(id, STOP_BACKOFF_MS[Math.min(i, STOP_BACKOFF_MS.length - 1)]!);
    expect(cur.state).toBe("needs_attention");
    expect(cur.attention).toMatch(/NOT confirmed stopped/);
    expect(stopCalls).toHaveLength(MAX_STOP_ATTEMPTS);
    expect(world.w.placements.has(DEV)).toBe(true);
    // the charger finally reports the stop: the SAME request resumes and finishes
    stopSession(7, "needed");
    cur = await advance(id, 1000);
    expect(["closing", "settling", "completed"]).toContain(cur.state);
  });
  it("a stop command that throws is recorded as unavailable, not as success", async () => {
    startSession();
    stop = { requestStop: async () => { throw new Error("binding down"); } };
    const id = ((await remove()) as { value: { id: string } }).value.id;
    expect((await advance(id)).sessions[0]!.stop).toMatchObject({ attempts: 1, lastOutcome: "unavailable", everAccepted: false });
  });
  it("covers a session that started after the request (before the block reached the engine)", async () => {
    const id = ((await remove()) as { value: { id: string } }).value.id;
    startSession(9);
    const cur = await advance(id);
    expect(cur.state).toBe("stopping");
    expect(cur.sessions.map((s) => s.transactionNo)).toEqual([9]);
  });
  it("a session starting between the plan and the close stops the close (re-checked inside the transaction)", async () => {
    const id = ((await remove()) as { value: { id: string } }).value.id;
    world.hooks.beforeClose = () => startSession(11);
    const cur = await advance(id);
    expect(world.w.closed).toHaveLength(0);
    expect(world.w.placements.has(DEV)).toBe(true);
    expect(cur.state).toBe("closing"); // still open; the next step sees the new session and stops it
    world.hooks.beforeClose = null;
    expect((await advance(id)).state).toBe("stopping");
  });
  it("a failed close rolls back wholly and the request stays resumable", async () => {
    const id = ((await remove()) as { value: { id: string } }).value.id;
    world.hooks.failCloseOnce = true;
    await expect(progressRemoval(deps(), id)).rejects.toThrow("close failed");
    expect(world.w.placements.has(DEV)).toBe(true);
    expect(world.w.closed).toHaveLength(0);
    expect((await advance(id)).state).toMatch(/completed|settling/);
  });
});

describe("idempotency, concurrency and authority", () => {
  it("the same key, or a second request for the same device, resumes the ONE open request", async () => {
    const a = await remove({ requestKey: "k1" });
    const b = await remove({ requestKey: "k1" });
    const c = await remove({ requestKey: "k-other" });
    const ids = [a, b, c].map((r) => (r as { value: { id: string } }).value.id);
    expect(new Set(ids).size).toBe(1);
    expect(world.w.requests.size).toBe(1);
  });
  it("two workers advancing at once cannot double-close or double-settle", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    stopSession(7, "needed");
    clock = new Date(clock.getTime() + 11_000);
    await Promise.all([progressRemoval(deps(), id), progressRemoval(deps(), id), progressRemoval(deps(), id)]);
    for (let i = 0; i < 4; i++) await advance(id);
    expect(world.w.closed).toHaveLength(1);
    expect(world.w.revisionBumps).toBe(1);
    expect(costingCalls.length).toBeLessThanOrEqual(3); // costing itself is idempotent; the request never settles twice
    expect((world.w.requests.values().next().value as { req: { state: string } }).req.state).toBe("completed");
  });
  it("an actor outside the device's organisation, or an unknown device, gets the same not_found (no tenant disclosure)", async () => {
    world.w.placements.set("other", { deviceId: "other", placementId: "px", orgId: OTHER_ORG, installationId: "i2", circuitId: null, label: "X", chargePointId: "CP-9" });
    const foreign = await requestRemoval(deps(), { deviceId: "other", kind: "remove", reason: "", requestKey: "kx", actor: ACTOR });
    const missing = await requestRemoval(deps(), { deviceId: "nope", kind: "remove", reason: "", requestKey: "ky", actor: ACTOR });
    expect(foreign).toEqual(missing);
    expect(foreign).toMatchObject({ ok: false, refusal: "not_found" });
  });
});

describe("cancel", () => {
  it("can undo before any stop is accepted, never after", async () => {
    const id = ((await remove()) as { value: { id: string } }).value.id;
    expect(await cancelRemoval(deps(), { requestId: id, actor: ACTOR })).toMatchObject({ ok: true, value: { state: "cancelled" } });
    expect(await remove({ requestKey: "k9" })).toMatchObject({ ok: true }); // a fresh request is possible again

    world = memoryLifecycle();
    world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
    startSession();
    const id2 = ((await remove({ requestKey: "k3" })) as { value: { id: string } }).value.id;
    await advance(id2); // stop accepted
    expect(await cancelRemoval(deps(), { requestId: id2, actor: ACTOR })).toMatchObject({ ok: false, refusal: "conflict" });
  });
});

describe("return of a known device", () => {
  beforeEach(async () => {
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id); await advance(id);
  });
  const ret = (over: Record<string, unknown> = {}) => returnDevice(deps(), { deviceId: DEV, installationId: INST, orgId: ORG, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1", actor: ACTOR, ...over } as never);

  it("lists the detached device and reattaches the SAME device id: no duplicate is created, old history stays", async () => {
    expect(await listReturnable(deps(), { installationId: INST, orgId: ORG, actor: ACTOR })).toEqual([expect.objectContaining({ deviceId: DEV, retired: false })]);
    expect(await ret()).toEqual({ ok: true, value: { deviceId: DEV } });
    expect(world.w.opened).toEqual([{ deviceId: DEV, chargePointId: "CP-1" }]);
    expect(world.w.history.size).toBe(1); // still one device
    expect(world.w.closed).toHaveLength(1); // the old period is preserved
  });
  it("refuses a placed device (needs an authorised transfer) and a second return", async () => {
    await ret();
    expect(await ret()).toMatchObject({ ok: false, refusal: "placed_elsewhere" });
  });
  it("discloses nothing across organisations or installations", async () => {
    expect(await returnDevice(deps({ authorise: () => true }), { deviceId: DEV, installationId: INST, orgId: OTHER_ORG, circuitId: "c", label: "x", chargePointId: "CP-1", actor: ACTOR })).toMatchObject({ ok: false, refusal: "not_found" });
    expect(await ret({ installationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).toMatchObject({ ok: false, refusal: "not_found" });
    expect(await returnDevice(deps({ authorise: () => false }), { deviceId: DEV, installationId: INST, orgId: ORG, circuitId: "c", label: "x", chargePointId: "CP-1", actor: ACTOR })).toMatchObject({ ok: false, refusal: "not_found" });
  });
  it("a released connection id taken by another device is a conflict, not a silent merge", async () => {
    world.w.identitiesInUse.add("CP-1");
    expect(await ret()).toMatchObject({ ok: false, refusal: "identity_in_use" });
    expect(world.w.placements.has(DEV)).toBe(false);
  });
  it("a retired device needs an explicit return; nothing is reactivated automatically", async () => {
    world = memoryLifecycle();
    world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
    world.w.history.set(DEV, { orgId: ORG, installationId: INST, retired: false });
    const id = ((await remove({ kind: "retire", reason: "damaged", requestKey: "kr" })) as { value: { id: string } }).value.id;
    await advance(id); await advance(id);
    expect(await ret()).toMatchObject({ ok: false, refusal: "retired_needs_return" });
    expect(await ret({ confirmRetiredReturn: true })).toMatchObject({ ok: true });
  });
});

describe("durable stop attempts (reserve before sending, resume by the same id)", () => {
  const ATTEMPT = (reqId: string, no: number, n: number) => `${reqId}:${no}:${n}`;
  const stored = (id: string) => world.w.requests.get(id)!.req;
  const open = async () => {
    startSession();
    return ((await remove()) as { value: { id: string } }).value.id;
  };

  it("the attempt is RESERVED durably BEFORE the command is sent, and carries request, attempt, placement and deadline", async () => {
    const id = await open();
    let reservedWhenSent: unknown = null;
    stop = { requestStop: async (i) => { reservedWhenSent = structuredClone(stored(id).sessions[0]!.stop.inFlight ?? null); stopInputs.push(i); return "accepted"; } };
    await advance(id);
    expect(reservedWhenSent).toMatchObject({ attemptId: ATTEMPT(id, 7, 1), reservedAt: T0.toISOString(), deadlineAt: new Date(T0.getTime() + STOP_ATTEMPT_WINDOW_MS).toISOString() });
    expect(stopInputs).toEqual([{ deviceId: DEV, transactionNo: 7, requestId: id, attemptId: ATTEMPT(id, 7, 1), placementId: "p1", deadlineMs: T0.getTime() + STOP_ATTEMPT_WINDOW_MS }]);
    // once the outcome is recorded the reservation is cleared and the attempt counted exactly once
    expect(stored(id).sessions[0]!.stop).toEqual({ attempts: 1, lastOutcome: "accepted", lastAt: T0.toISOString(), everAccepted: true, maybeSent: true });
  });
  it("concurrent progress reserves ONE attempt and sends ONCE; the loser sends nothing (the conflict is seen before, not after, a duplicate)", async () => {
    world = memoryLifecycle({}, { serialize: true });
    world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
    world.w.history.set(DEV, { orgId: ORG, installationId: INST, retired: false });
    const id = await open();
    await Promise.all([progressRemoval(deps(), id), progressRemoval(deps(), id), progressRemoval(deps(), id)]);
    expect(stopInputs).toHaveLength(1);
    expect(stored(id).sessions[0]!.stop).toMatchObject({ attempts: 1, lastOutcome: "accepted" });
  });
  it("a crash after the reservation (or after the send) leaves the attempt resumable: the SAME id is delivered again and counted once", async () => {
    const id = await open();
    // Fail the transaction that would record the outcome (reads+plan = run 1, reserve = run 2, record = run 3).
    let runs = 0;
    const crashing: Deps = { ...deps(), store: { run: (fn) => { runs++; if (runs === 3) throw new Error("process died"); return world.store.run(fn); } } };
    await expect(progressRemoval(crashing, id)).rejects.toThrow("process died");
    expect(stopInputs).toHaveLength(1);
    expect(stored(id).sessions[0]!.stop).toMatchObject({ attempts: 0, inFlight: { attemptId: ATTEMPT(id, 7, 1) } });
    const cur = await advance(id, 1); // well inside the backoff: a resume is not a new attempt and is not delayed by it
    expect(stopInputs.map((i) => i.attemptId)).toEqual([ATTEMPT(id, 7, 1), ATTEMPT(id, 7, 1)]);
    expect(cur.sessions[0]!.stop).toMatchObject({ attempts: 1, lastOutcome: "accepted" });
    expect(cur.sessions[0]!.stop.inFlight).toBeUndefined();
    await advance(id, 1000); // and a refresh afterwards does not send again
    expect(stopInputs).toHaveLength(2);
  });
  it("a real StopTransaction after a lost outcome closes the removal without another command; the stale reservation is dropped", async () => {
    const id = await open();
    let runs = 0;
    const crashing: Deps = { ...deps(), store: { run: (fn) => { runs++; if (runs === 3) throw new Error("process died"); return world.store.run(fn); } } };
    await expect(progressRemoval(crashing, id)).rejects.toThrow();
    stopSession(7, "needed");
    const cur = await advance(id, 1000);
    expect(stopInputs).toHaveLength(1);
    expect(["settling", "completed"]).toContain(cur.state);
    expect(cur.sessions[0]!.stop.inFlight).toBeUndefined();
    expect(cur.sessions[0]!.stopConfirmedAt).not.toBeNull();
  });
  it("a deliberate retry is a NEW attempt (next number) and only after the backoff", async () => {
    stopOutcome = "timeout";
    const id = await open();
    await advance(id);
    await advance(id, 1000); // inside the 10 s backoff: nothing is sent
    expect(stopInputs).toHaveLength(1);
    await advance(id, 10_000);
    expect(stopInputs.map((i) => i.attemptId)).toEqual([ATTEMPT(id, 7, 1), ATTEMPT(id, 7, 2)]);
    expect(stored(id).sessions[0]!.stop).toMatchObject({ attempts: 2, lastOutcome: "timeout", maybeSent: true });
  });
  it("an ACCEPTED command is still not a stop, and the removal stays pending after any number of refreshes", async () => {
    const id = await open();
    const cur = await advance(id);
    expect(cur).toMatchObject({ state: "stopping", sessions: [{ stopConfirmedAt: null }] });
    expect(world.w.closed).toHaveLength(0);
  });
  it("cancel is refused whenever a command MAY have reached the charger (accepted, timed out, ambiguous, in flight) but allowed after a provable non-send", async () => {
    for (const outcome of ["accepted", "timeout", "unavailable"] as const) {
      world = memoryLifecycle();
      world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
      startSession();
      stopOutcome = outcome;
      const id = ((await remove({ requestKey: `k-${outcome}` })) as { value: { id: string } }).value.id;
      await advance(id);
      expect(await cancelRemoval(deps(), { requestId: id, actor: ACTOR }), outcome).toMatchObject({ ok: false, refusal: "conflict" });
    }
    for (const outcome of ["offline", "rejected"] as const) {
      world = memoryLifecycle();
      world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
      startSession();
      stopOutcome = outcome;
      const id = ((await remove({ requestKey: `k-${outcome}` })) as { value: { id: string } }).value.id;
      await advance(id);
      expect(await cancelRemoval(deps(), { requestId: id, actor: ACTOR }), outcome).toMatchObject({ ok: true, value: { state: "cancelled" } });
    }
    // reserved but not yet recorded counts as "may have been sent"
    world = memoryLifecycle();
    world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
    startSession();
    const id = ((await remove({ requestKey: "k-fly" })) as { value: { id: string } }).value.id;
    let runs = 0;
    const crashing: Deps = { ...deps(), store: { run: (fn) => { runs++; if (runs === 3) throw new Error("process died"); return world.store.run(fn); } } };
    await expect(progressRemoval(crashing, id)).rejects.toThrow();
    expect(await cancelRemoval(deps(), { requestId: id, actor: ACTOR })).toMatchObject({ ok: false, refusal: "conflict" });
  });
  it("rows written before reservations existed (no inFlight / maybeSent) still progress, retry and cancel as before", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    const row = world.w.requests.get(id)!;
    row.req.sessions = [{ transactionNo: 7, transactionId: "tx-7", stop: { attempts: 1, lastOutcome: "offline", lastAt: T0.toISOString(), everAccepted: false }, stopConfirmedAt: null, settlement: { state: "pending", reason: null } }];
    row.req.state = "stopping";
    row.req.version = 2;
    expect(await cancelRemoval(deps(), { requestId: id, actor: ACTOR })).toMatchObject({ ok: true, value: { state: "cancelled" } });
    world.w.requests.get(id)!.req.state = "stopping"; // the save replaced the stored object: re-fetch it
    const cur = await advance(id, 10_000);
    expect(stopInputs.map((i) => i.attemptId)).toEqual([ATTEMPT(id, 7, 2)]);
    expect(cur.sessions[0]!.stop).toMatchObject({ attempts: 2, lastOutcome: "accepted", everAccepted: true });
  });
  it("without a stop path nothing is reserved and nothing is claimed as possibly sent", async () => {
    const id = await open();
    stop = null;
    expect(await progressRemoval(deps(), id)).toMatchObject({ ok: false, refusal: "stop_unavailable" });
    const cur = world.w.requests.get(id)!.req;
    expect(stopInputs).toHaveLength(0);
    expect(cur.sessions[0]!.stop).toEqual({ attempts: 0, lastOutcome: null, lastAt: null, everAccepted: false });
    expect(cur.sessions[0]!.stop.inFlight).toBeUndefined();
  });
  it("a request that moved on while this call reserved is returned as it stands; this call sends nothing", async () => {
    const id = await open();
    // The first run (read + plan) happens, then another worker advances the request before this call's reservation.
    let runs = 0;
    // Replace the committed row: a real SQL update cannot mutate an earlier caller's materialized snapshot.
    const racing: Deps = { ...deps(), store: { run: async (fn) => { runs++; if (runs === 2) { const r = world.w.requests.get(id)!; r.req = { ...r.req, version: r.req.version + 1 }; } return world.store.run(fn); } } };
    const r = await progressRemoval(racing, id);
    expect(r).toMatchObject({ ok: true, value: { version: 2 } });
    expect(stopInputs).toHaveLength(0);
  });
});

describe("transition table", () => {
  it("covers every state a request can be in, so the published table cannot silently drift", () => {
    const states = new Set(TRANSITIONS.map((t) => t.from));
    for (const s of ["(none)", "requested", "stopping", "closing", "settling", "needs_attention"]) expect(states.has(s as never), s).toBe(true);
    expect(TRANSITIONS.every((t) => t.effects && t.success && t.pendingOrFailure)).toBe(true);
  });
});

describe("concurrent and conflicting removal requests", () => {
  const winnerReq = (over: Record<string, unknown> = {}) => ({
    id: "winner-0001", kind: "remove" as const, state: "requested" as const, orgId: ORG, installationId: INST, deviceId: DEV, placementId: "p1", reason: "removed from installation",
    actorKind: "shared_login" as const, actorLabel: ACTOR.label, requestedAt: T0.toISOString(), serviceEndedAt: null, completedAt: null, sessions: [], attention: null, identityClosed: false, version: 1, ...over,
  });

  it("the LOSER of the uniqueness race returns the winner's request after rollback, not an error and not a second request", async () => {
    world.hooks.raceOnInsert = winnerReq();
    const r = await remove({ requestKey: "loser-key" });
    expect(r).toMatchObject({ ok: true, value: { id: "winner-0001" } });
    expect(world.w.requests.size).toBe(1); // the loser's own row was rolled back; only the winner exists
  });
  it("re-authorises before resuming: a winner owned by ANOTHER organisation is indistinguishable from none", async () => {
    world.hooks.raceOnInsert = winnerReq({ orgId: OTHER_ORG });
    const r = await requestRemoval(deps({ authorise: (_a, orgId) => orgId === ORG }), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k-x", actor: ACTOR });
    expect(r).toEqual({ ok: false, refusal: "not_found", message: "Charger not found" });
  });
  it("a unique violation that is NOT one of the two known constraints is never turned into success", async () => {
    world.hooks.raceOnInsert = null;
    const boom = { ...world.store, run: async () => { throw new Error("duplicate key value violates unique constraint \"something_else\""); } };
    await expect(requestRemoval({ ...deps(), store: boom as never }, { deviceId: DEV, kind: "remove", reason: "", requestKey: "k-y", actor: ACTOR })).rejects.toThrow("something_else");
  });
  it("if the race signal arrives but no winner can be found, the original error surfaces (no invented success)", async () => {
    // a conflict thrown by a store whose winner was already removed
    let first = true;
    const flaky = { run: async (fn: never) => { if (first) { first = false; throw new OpenRequestConflict(); } return world.store.run(fn); } };
    await expect(requestRemoval({ ...deps(), store: flaky as never }, { deviceId: DEV, kind: "remove", reason: "", requestKey: "k-z", actor: ACTOR })).rejects.toBeInstanceOf(OpenRequestConflict);
  });
  it("same key for a DIFFERENT device is a conflict, and never returns the other request", async () => {
    world.w.placements.set("dev2", { deviceId: "dev2", placementId: "p2", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 2", chargePointId: "CP-2" });
    const a = await remove({ requestKey: "shared-key" });
    expect(a).toMatchObject({ ok: true });
    const b = await requestRemoval(deps(), { deviceId: "dev2", kind: "remove", reason: "", requestKey: "shared-key", actor: ACTOR });
    expect(b).toMatchObject({ ok: false, refusal: "conflict" });
    expect(JSON.stringify(b)).not.toContain((a as { value: { id: string } }).value.id);
  });
  it("a separate key for the same device resumes the SAME request; a different kind is a conflict, not a silent reinterpretation", async () => {
    const a = (await remove({ requestKey: "k1" })) as { value: { id: string } };
    const b = (await remove({ requestKey: "k2" })) as { value: { id: string } };
    expect(b.value.id).toBe(a.value.id);
    expect(await remove({ requestKey: "k3", kind: "retire", reason: "end of life" })).toMatchObject({ ok: false, refusal: "conflict" });
    expect(world.w.requests.size).toBe(1);
  });
  it("a key owned by another organisation resumes as not_found, never as that organisation's request", async () => {
    await remove({ requestKey: "k1" });
    const r = await requestRemoval(deps({ authorise: () => false }), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR });
    expect(r).toMatchObject({ ok: false, refusal: "not_found" });
  });
  it("many parallel requests with distinct keys yield exactly one request and one block", async () => {
    world = memoryLifecycle({}, { serialize: true });
    world.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
    world.w.history.set(DEV, { orgId: ORG, installationId: INST, retired: false });
    const all = await Promise.all(Array.from({ length: 6 }, (_, i) => remove({ requestKey: `p${i}` })));
    const ids = new Set(all.filter((r) => r.ok).map((r) => (r as { value: { id: string } }).value.id));
    expect(ids.size).toBe(1);
    expect(world.w.requests.size).toBe(1);
  });
  it("takes the placement lock BEFORE observing sessions, so a start holding the placement is waited for, not missed", async () => {
    world.hooks.log.length = 0;
    await remove();
    expect(world.hooks.log.slice(0, 2)).toEqual(["lock:p1", "observe"]);
  });
});

describe("superseded sessions (a new start on the same connector while an older one never stopped)", () => {
  const superseded = (no: number) => startSession(no, { superseded: true } as never);

  it("stops the current session but keeps removal pending while the earlier stop is unconfirmed", async () => {
    superseded(101);
    startSession(102);
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id); // attempt the current session; the older one requires evidence
    expect(stopCalls.map((c) => c.transactionNo)).toEqual([102]);
    stopSession(102, "needed"); // 102's durable stop arrives
    let cur = await advance(id, 11_000);
    expect(cur.state).toBe("needs_attention");
    expect(cur.attention).toContain("101");
    expect(world.w.placements.has(DEV)).toBe(true);
  });
  it("is NOT treated as stopped or settled: no stop is fabricated, no cost is run, the hold is visible with its reason", async () => {
    superseded(101);
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    const cur = await advance(id);
    const s = cur.sessions.find((x) => x.transactionNo === 101)!;
    expect(s.stopConfirmedAt).toBeNull();
    expect(s.settlement).toEqual({ state: "held", reason: "stop_unconfirmed_superseded" });
    expect(world.w.txs.find((t) => t.transactionNo === 101)!.stoppedReceivedAt).toBeNull(); // the engine's evidence is untouched
    expect(costingCalls).toEqual([]);
    expect(stopCalls.some((c) => c.transactionNo === 101)).toBe(false); // no pointless command for an abandoned id
  });
  it("a late real stop resumes removal and settlement without inventing evidence", async () => {
    superseded(101);
    const id = ((await remove()) as { value: { id: string } }).value.id;
    expect(await advance(id)).toMatchObject({ state: "needs_attention", sessions: [{ transactionNo: 101, settlement: { state: "held", reason: "stop_unconfirmed_superseded" } }] });
    stopSession(101, "needed");
    let cur = await advance(id);
    for (let i = 0; i < 4 && cur.state !== "completed"; i++) cur = await advance(id);
    expect(cur).toMatchObject({ state: "completed", sessions: [{ transactionNo: 101, settlement: { state: "settled" } }] });
    expect(costingCalls).toContain("tx-101");
  });
  it("the genuinely-open superseding session still gates removal: it needs a real stop", async () => {
    superseded(101);
    startSession(102);
    stopOutcome = "offline";
    const id = ((await remove()) as { value: { id: string } }).value.id;
    let cur = await advance(id);
    for (let i = 0; i < MAX_STOP_ATTEMPTS; i++) cur = await advance(id, 400_000);
    expect(cur.state).toBe("needs_attention");
    expect(world.w.placements.has(DEV)).toBe(true);
  });
  it("only superseded rows are exempt: an ordinary open session with the same connector is not", async () => {
    startSession(103);
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    expect(stopCalls.map((c) => c.transactionNo)).toEqual([103]);
  });
  it("with an unconfirmed superseded session and no stop path, removal is unavailable", async () => {
    superseded(101);
    stop = null;
    const r = await remove();
    expect(r).toMatchObject({ ok: false, refusal: "stop_unavailable" });
    expect(world.w.placements.has(DEV)).toBe(true);
  });
});

describe("selecting due removals for the bounded recovery pass (selectDueRemovals)", () => {
  it("does not burn stop attempts if the API loses its command binding after a removal was requested", async () => {
    startSession();
    const result = await remove();
    if (!result.ok) throw new Error("fixture rejected");
    const before = structuredClone(world.w.requests.get(result.value.id)!.req);
    stop = null;
    for (let i = 0; i < MAX_STOP_ATTEMPTS + 1; i++) {
      expect(await progressRemoval(deps(), result.value.id)).toMatchObject({ ok: false, refusal: "stop_unavailable" });
    }
    expect(world.w.requests.get(result.value.id)!.req).toEqual(before);
    expect(stopCalls).toEqual([]);
  });
  const select = (over: Partial<{ scanLimit: number; maxDue: number }> = {}) => selectDueRemovals(deps(), { scanLimit: 100, ...over });

  it("selects only requests whose next step would change something: not a stop inside its backoff, not an exhausted one", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    expect(await select()).toMatchObject({ supported: true, scanned: 1, due: [{ requestId: id, needsStop: true, onlyCosting: false }] });
    await advance(id); // stop sent and accepted; the next attempt is inside the backoff
    expect((await select()).due).toEqual([]);
    clock = new Date(clock.getTime() + STOP_BACKOFF_MS[0] + 1);
    expect((await select()).due).toMatchObject([{ requestId: id, needsStop: true }]);
  });
  it("a real stop makes a stopping request due for closing, with no stop to send", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    stopSession(7, "needed");
    expect((await select()).due).toMatchObject([{ requestId: id, state: "stopping", needsStop: false }]);
  });
  it("a settling request that only waits for costing is marked onlyCosting; finished requests are never listed", async () => {
    startSession();
    const id = ((await remove()) as { value: { id: string } }).value.id;
    await advance(id);
    stopSession(7, "needed");
    await advance(id, 11_000); // placement closed, settlement pending
    expect((await select()).due).toMatchObject([{ requestId: id, state: "settling", onlyCosting: true }]);
    await advance(id); // costing runs, completed
    expect(await select()).toMatchObject({ scanned: 0, due: [] });
  });
  it("reports truncation when more requests are open than the scan window, and a store without the optional methods as unsupported", async () => {
    startSession();
    await remove();
    const two = memoryLifecycle();
    expect(await selectDueRemovals({ store: two.store, now: () => clock }, { scanLimit: 5 })).toMatchObject({ supported: true, scanned: 0, scanTruncated: false });
    const open = world.w.requests.size;
    expect(open).toBe(1);
    expect(await select({ scanLimit: 0 })).toMatchObject({ scanned: 0, scanTruncated: true });
    const bare = { run: (fn: never) => world.store.run(((tx: object) => (fn as (t: object) => unknown)({ ...tx, listOpen: undefined, observedMany: undefined })) as never) } as never;
    expect(await selectDueRemovals({ store: bare, now: () => clock }, { scanLimit: 5 })).toMatchObject({ supported: false, due: [] });
  });
});

describe("placement-closed notification (shared live room)", () => {
  type Closed = { installationId: string; deviceId: string; placementId: string };
  const withNotice = (calls: Closed[], over: Partial<Deps> = {}) => deps({ onPlacementClosed: async (i) => { calls.push(i); }, ...over });
  const request = async (d: Deps) => ((await requestRemoval(d, { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR } as never)) as { value: { id: string } }).value.id;

  it("fires once, AFTER the placement is closed, with the placement that was closed", async () => {
    const calls: Closed[] = [];
    const d = withNotice(calls);
    const id = await request(d);
    expect(calls).toHaveLength(0); // requesting a removal closes nothing
    const seenAtNotice: boolean[] = [];
    const notified: Deps = { ...d, onPlacementClosed: async (i) => { seenAtNotice.push(world.w.placements.has(DEV)); calls.push(i); } };
    const r = await progressRemoval(notified, id);
    expect(r).toMatchObject({ ok: true, value: { state: "completed", identityClosed: true } });
    expect(seenAtNotice).toEqual([false]); // the commit had already happened when the room was told
    expect(calls).toEqual([{ installationId: INST, deviceId: DEV, placementId: "p1" }]);
    await progressRemoval(notified, id); // a repeated step on a completed request tells nobody again
    expect(calls).toHaveLength(1);
  });

  it("is silent while a session is still open: nothing is announced for a placement that has not closed", async () => {
    startSession();
    const calls: Closed[] = [];
    const d = withNotice(calls);
    const id = await request(d);
    stopOutcome = "accepted"; // Accepted is not a stop
    await progressRemoval(d, id);
    expect(world.w.placements.has(DEV)).toBe(true);
    expect(calls).toHaveLength(0);
    stopSession();
    for (let i = 0; i < 3; i++) await progressRemoval(d, id);
    expect(calls).toEqual([{ installationId: INST, deviceId: DEV, placementId: "p1" }]);
  });

  it("a failing notification never fails or undoes the removal", async () => {
    const d = withNotice([], { onPlacementClosed: async () => { throw new Error("room unreachable"); } });
    const id = await request(d);
    const r = await progressRemoval(d, id);
    expect(r).toMatchObject({ ok: true, value: { state: "completed", identityClosed: true } });
    expect(world.w.placements.has(DEV)).toBe(false);
  });
});

describe("a lost race to close the placement", () => {
  it("is a lost race, not a failure: the loser rolls back and returns the current request instead of throwing", async () => {
    const r = await remove();
    const id = (r as { value: { id: string } }).value.id;
    // Another worker closes the placement between this one's check and its close. (The in-memory store rolls the loser's whole
    // transaction back, including this simulated winner; the two-connection proof against real row locks is in
    // src/lib/pg-concurrency, where the winner's commit is genuinely visible.)
    world.hooks.beforeClose = () => { world.hooks.beforeClose = null; world.w.placements.delete(DEV); };
    const out = await progressRemoval(deps(), id);
    expect(out.ok).toBe(true); // before the fix this threw "placement is no longer open"
    expect(world.w.closed).toHaveLength(0); // the loser closed nothing
  });
});
