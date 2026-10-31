// Bounded independent recovery. These tests run the REAL orchestrator, costPending and progressRemoval over in-memory
// doubles. They prove the control flow, the bounds and the invariants listed in each title. They do NOT exercise
// PostgreSQL locking, SQL plans, the Cloudflare cron trigger or hibernation.
import { describe, expect, it, vi } from "vitest";
import type { ClauseInput, RateRefInput } from "@straumvakt/commercial/agreement/types";
import type { AgreementFacts, CostingTxFacts } from "../costing/cost-session";
import { MAX_COSTING_ATTEMPTS, type CostingStore } from "../costing/service";
import { memoryCostingStore } from "../costing/__tests__/memory-costing-store";
import { buildSnapshot } from "../costing/terms-snapshot";
import { MAX_STOP_ATTEMPTS, STOP_BACKOFF_MS, type LifecycleRequest } from "../lifecycle/model";
import { progressRemoval, requestRemoval, type Deps, type StopPort } from "../lifecycle/service";
import { ACTOR, memoryLifecycle } from "../lifecycle/__tests__/memory-store";
import { runRecovery, type RecoveryPorts } from "./recovery";
import { runScheduledRecovery } from "./recovery-live";

const ORG = "11111111-1111-4111-8111-111111111111";
const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const FACTOR = "44444444-4444-4444-8444-444444444444";
const SUPPLIER = "55555555-5555-4555-8555-555555555555";
const T0 = new Date("2026-10-30T10:00:00Z");
const T1 = new Date("2026-10-30T12:00:00Z");

const clause: ClauseInput = { costFactorId: FACTOR, costFactorCode: "energy", defaultBearerType: "usr", defaultBearerRef: null, defaultRateRefCode: "ENERGY", allocation: { passthrough: { splits: [{ bearer_type: "usr", share_pct: 100 }] }, markup: null } };
const rate: RateRefInput = { id: "rr1", code: "ENERGY", costFactorId: FACTOR, basis: "per_kwh", priceMinor: 2000n, vatRatePct: 24, currency: "ISK", supplierOrgId: SUPPLIER, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: null };
const agr: AgreementFacts = { installationAgreementId: "agr1", driverGroup: { id: GROUP, ownerOrgId: ORG }, clauses: [clause], rules: [], rateReferences: [rate] };

const txFacts = (id: string, over: Partial<CostingTxFacts> = {}): CostingTxFacts => ({
  id, orgId: ORG, installationId: INST, deviceId: DEV, placementId: `pl-${id}`, authorized: true, userId: USER, energyWh: 12_000, energyQuality: "ok",
  startedReportedAt: T0, stoppedReportedAt: T1, startedReceivedAt: T0, stoppedReceivedAt: T1, terms: null, ...over,
});
const withTerms = async (id: string, over: Partial<CostingTxFacts> = {}): Promise<CostingTxFacts> => ({ ...txFacts(id, over), terms: await buildSnapshot({ facts: agr, at: T0, capturedAt: T0 }) });

let clock = new Date(T0);
const stopInputs: Parameters<StopPort["requestStop"]>[0][] = [];
const stop: StopPort = { requestStop: async (i) => { stopInputs.push(i); return "accepted"; } };
const resetShared = () => { clock = new Date(T0); stopInputs.length = 0; };

/** Lifecycle double with one placed device, plus a costing store whose outcomes are mirrored into the lifecycle's view of each transaction. */
async function lifeWorld(costingRows: CostingTxFacts[], opts: { serialize?: boolean } = {}) {
  const life = memoryLifecycle({}, opts);
  life.w.placements.set(DEV, { deviceId: DEV, placementId: "p1", orgId: ORG, installationId: INST, circuitId: "c1", label: "Bay 1", chargePointId: "CP-1" });
  life.w.history.set(DEV, { orgId: ORG, installationId: INST, retired: false });
  const costing = memoryCostingStore({ rows: costingRows });
  const runs = { n: 0 };
  const store: CostingStore = {
    run: async (fn) => {
      runs.n++;
      try { return await costing.store.run(fn); } finally {
        for (const r of costing.state.rows) {
          const t = life.w.txs.find((x) => x.transactionId === r.tx.id);
          if (t && r.state !== "needed") t.costingState = r.state;
        }
      }
    },
    recordFailure: (id, m, at) => costing.store.recordFailure(id, m, at),
  };
  const ports = (over: Partial<RecoveryPorts> = {}): RecoveryPorts => ({ costing: store, lifecycle: life.store, stop, now: () => clock, ...over });
  const deps = (): Deps => ({ store: life.store, stop, costing: null, authorise: () => true, now: () => clock, newId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })() });
  return { life, costing, store, runs, ports, deps };
}

const startSession = (life: ReturnType<typeof memoryLifecycle>, no = 7, deviceId = DEV) =>
  life.w.txs.push({ transactionNo: no, transactionId: `tx-${no}`, deviceId, stoppedReceivedAt: null, authorized: true, costingState: "not_needed" });
const stopSession = (life: ReturnType<typeof memoryLifecycle>, no = 7, costingState = "needed") => {
  const t = life.w.txs.find((x) => x.transactionNo === no)!;
  t.stoppedReceivedAt = new Date(clock);
  t.costingState = costingState;
};
const only = (life: ReturnType<typeof memoryLifecycle>) => [...life.w.requests.values()][0]!.req;

describe("costing recovery without any fast-path hint", () => {
  it("costs a committed stopped session exactly once with no charger message and no UI action, however often it runs", async () => {
    resetShared();
    const w = await lifeWorld([await withTerms("tx-7")]);
    const first = await runRecovery(w.ports({ lifecycle: null }));
    expect(first).toMatchObject({ status: "ran", costing: { attempted: 1, costed: 1, held: 0, failed: 0 } });
    await runRecovery(w.ports({ lifecycle: null }));
    await runRecovery(w.ports({ lifecycle: null }));
    expect(w.costing.state.written).toHaveLength(1);
  });
  it("duplicate concurrent passes cannot double the lines", async () => {
    resetShared();
    const w = await lifeWorld([await withTerms("tx-7")]);
    const [a, b] = await Promise.all([runRecovery(w.ports({ lifecycle: null })), runRecovery(w.ports({ lifecycle: null }))]);
    expect(a.costing.costed + b.costing.costed).toBe(1);
    expect(w.costing.state.written).toHaveLength(1);
  });
  it("a poison row is parked after the bound and a later good row still progresses in the same pass", async () => {
    resetShared();
    const w = await lifeWorld([await withTerms("poison"), await withTerms("good")]);
    w.costing.hooks.failWriteFor.add("poison");
    const r = await runRecovery(w.ports({ lifecycle: null }));
    expect(w.costing.state.rows.find((x) => x.tx.id === "poison")).toMatchObject({ state: "unresolved_context", attempts: MAX_COSTING_ATTEMPTS });
    expect(w.costing.state.rows.find((x) => x.tx.id === "good")!.state).toBe("costed");
    expect(r.costing).toMatchObject({ failed: MAX_COSTING_ATTEMPTS, costed: 1 });
  });
  it("missing or unreadable terms stay HELD: no lines, no fallback to today's rates, never a zero-cost settlement", async () => {
    resetShared();
    const w = await lifeWorld([txFacts("none", { terms: null }), txFacts("bad", { terms: { nonsense: true } as never })]);
    const r = await runRecovery(w.ports({ lifecycle: null }));
    expect(w.costing.state.rows.map((x) => x.state)).toEqual(["unresolved_context", "unresolved_context"]);
    expect(w.costing.state.written).toHaveLength(0);
    expect(r.costing).toMatchObject({ held: 2, costed: 0 });
  });
  it("late meter evidence on an already-costed session is not repriced by a later pass", async () => {
    resetShared();
    const w = await lifeWorld([await withTerms("tx-7")]);
    await runRecovery(w.ports({ lifecycle: null }));
    w.costing.state.rows[0]!.tx = { ...w.costing.state.rows[0]!.tx, energyWh: 99_000 };
    await runRecovery(w.ports({ lifecycle: null }));
    expect(w.costing.state.written).toHaveLength(1);
  });
});

describe("bounds", () => {
  it("stops when recording a failed costing attempt is unavailable, rather than consuming the retry budget", async () => {
    const run = vi.fn(async (fn: Parameters<CostingStore["run"]>[0]) => fn({
      claimOne: async () => ({ tx: txFacts("outage"), attempts: 0 }),
      placement: async () => { throw new Error("read failed"); },
    } as never));
    const recordFailure = vi.fn(async () => { throw new Error("failure recording unavailable"); });
    const report = await runRecovery({ costing: { run, recordFailure } as CostingStore, lifecycle: null, stop: null });
    expect(report.status).toBe("unavailable");
    expect(report.costing.failed).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("reports an outage during lifecycle-triggered costing and stops the pass", async () => {
    resetShared();
    const w = await lifeWorld([]);
    startSession(w.life);
    const req = await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "outage", actor: ACTOR });
    if (!req.ok) throw new Error("fixture rejected");
    stopSession(w.life);
    await progressRemoval(w.deps(), req.value.id);
    let calls = 0;
    const costing: CostingStore = {
      run: async (fn) => {
        calls++;
        if (calls > 1) throw new Error("database unavailable during targeted costing");
        return fn({ claimOne: async () => null } as never);
      },
      recordFailure: async () => undefined,
    };
    const report = await runRecovery(w.ports({ costing }));
    expect(report).toMatchObject({ status: "unavailable", reason: "database_error", costing: { failed: 1 } });
    expect(calls).toBe(2);
    expect(only(w.life).state).not.toBe("completed");
  });

  it("never makes more than the costing cap of attempts, however many rows are waiting, and reports that more remain", async () => {
    resetShared();
    const rows = await Promise.all(Array.from({ length: 25 }, (_, i) => withTerms(`r${i}`)));
    const w = await lifeWorld(rows);
    const r = await runRecovery(w.ports({ lifecycle: null }));
    expect(r.costing).toMatchObject({ attempted: 20, costed: 20, limitReached: true });
    expect(w.costing.state.rows.filter((x) => x.state === "needed")).toHaveLength(5);
    expect(w.runs.n).toBe(20);
  });
  it("lifecycle steps draw from the SAME costing budget and cannot multiply it", async () => {
    resetShared();
    const fillers = await Promise.all(Array.from({ length: 20 }, (_, i) => withTerms(`f${i}`)));
    const w = await lifeWorld([...fillers, await withTerms("tx-7")]); // tx-7 is last, so the sweep's 20 attempts never reach it
    startSession(w.life);
    const id = ((await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR })) as { value: { id: string } }).value.id;
    await progressRemoval(w.deps(), id); // a stop was sent and accepted
    stopSession(w.life, 7, "needed"); // the real StopTransaction arrives
    const r = await runRecovery(w.ports());
    expect(w.runs.n).toBe(20); // 20 in total, not 20 + one per lifecycle step
    expect(r.costing).toMatchObject({ attempted: 20, deferredForBudget: 1, limitReached: true });
    expect(w.costing.state.rows.find((x) => x.tx.id === "tx-7")!.state).toBe("needed");
    expect(only(w.life).state).toBe("settling"); // placement closed, settlement honestly still pending
    expect(w.life.w.closed).toHaveLength(1);
    const again = await runRecovery(w.ports()); // the next pass finishes it
    expect(again.lifecycle).toMatchObject({ completed: 1 });
    expect(only(w.life).state).toBe("completed");
  });
  it("a spent deadline prevents further work from starting and is reported, never hidden", async () => {
    resetShared();
    const rows = await Promise.all(Array.from({ length: 10 }, (_, i) => withTerms(`r${i}`)));
    const w = await lifeWorld(rows);
    let t = 0;
    const r = await runRecovery(w.ports({ lifecycle: null, nowMs: () => (t += 10) }), { budgetMs: 25 });
    expect(r.budgetExhausted).toBe(true);
    expect(r.costing.attempted).toBeGreaterThan(0);
    expect(r.costing.attempted).toBeLessThan(10);
    expect(w.costing.state.rows.filter((x) => x.state === "needed").length).toBeGreaterThan(0);
  });
  it("an unreachable database ends the pass at once: unavailable, one attempt, lifecycle untouched, nothing claimed to have succeeded", async () => {
    resetShared();
    const life = memoryLifecycle();
    const lifeRun = vi.spyOn(life.store, "run");
    let calls = 0;
    const down: CostingStore = { run: async () => { calls++; throw new Error("db down"); }, recordFailure: async () => undefined };
    const r = await runRecovery({ costing: down, lifecycle: life.store, stop, now: () => clock });
    expect(r).toMatchObject({ status: "unavailable", reason: "database_error" });
    expect(calls).toBe(1);
    expect(lifeRun).not.toHaveBeenCalled();
  });
});

describe("lifecycle recovery", () => {
  it("a real stop that arrived while the removal was pending advances to closed and settled with no UI action", async () => {
    resetShared();
    const w = await lifeWorld([await withTerms("tx-7")]);
    startSession(w.life);
    const id = ((await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR })) as { value: { id: string } }).value.id;
    await progressRemoval(w.deps(), id);
    expect(only(w.life).state).toBe("stopping");
    stopSession(w.life, 7, "needed");
    const r = await runRecovery(w.ports());
    expect(r.lifecycle).toMatchObject({ supported: true, due: 1, attempted: 1, advanced: 1, completed: 1 });
    expect(only(w.life)).toMatchObject({ state: "completed", identityClosed: true });
    expect(w.life.w.closed).toHaveLength(1);
  });
  it("an accepted-only stop stays pending: nothing is sent again inside the backoff, and a later attempt uses the NEXT stable attempt id", async () => {
    resetShared();
    const w = await lifeWorld([]);
    startSession(w.life);
    const id = ((await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR })) as { value: { id: string } }).value.id;
    await progressRemoval(w.deps(), id);
    expect(stopInputs).toHaveLength(1);
    const within = await runRecovery(w.ports());
    expect(within.lifecycle.due).toBe(0);
    expect(stopInputs).toHaveLength(1);
    expect(w.life.w.closed).toHaveLength(0);
    clock = new Date(clock.getTime() + STOP_BACKOFF_MS[0] + 1);
    await runRecovery(w.ports());
    expect(stopInputs.map((s) => s.attemptId)).toEqual([`${id}:7:1`, `${id}:7:2`]);
    expect(only(w.life).state).toBe("stopping");
  });
  it("without a stop path a request that needs a stop is skipped untouched: no attempt burned, no 'unavailable' recorded", async () => {
    resetShared();
    const w = await lifeWorld([]);
    startSession(w.life);
    await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR });
    const before = structuredClone(only(w.life));
    const r = await runRecovery(w.ports({ stop: null }));
    expect(r.lifecycle).toMatchObject({ stopUnavailableSkipped: 1, attempted: 0 });
    expect(only(w.life)).toEqual(before);
  });
  it("a store without the optional listing methods is reported as unsupported, not as an empty success", async () => {
    resetShared();
    const w = await lifeWorld([]);
    const bare = { run: (fn: never) => w.life.store.run(((tx: object) => (fn as (t: object) => unknown)({ ...tx, listOpen: undefined, observedMany: undefined })) as never) } as never;
    const r = await runRecovery(w.ports({ lifecycle: bare }));
    expect(r.lifecycle.supported).toBe(false);
  });

  const exhausted = (life: ReturnType<typeof memoryLifecycle>, n: number) => {
    const req: LifecycleRequest = {
      id: `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`, kind: "remove", state: "needs_attention", orgId: ORG, installationId: INST, deviceId: `dev-x${n}`, placementId: `px${n}`,
      reason: "r", actorKind: "shared_login", actorLabel: ACTOR.label, requestedAt: T0.toISOString(), serviceEndedAt: null, completedAt: null, attention: "Stop not accepted", identityClosed: false, version: 3,
      sessions: [{ transactionNo: 100 + n, transactionId: `tx-${100 + n}`, stop: { attempts: MAX_STOP_ATTEMPTS, lastOutcome: "offline", lastAt: T0.toISOString(), everAccepted: false }, stopConfirmedAt: null, settlement: { state: "pending", reason: null } }],
    };
    life.w.requests.set(req.id, { req, key: `kx${n}` });
    life.w.txs.push({ transactionNo: 100 + n, transactionId: `tx-${100 + n}`, deviceId: `dev-x${n}`, stoppedReceivedAt: null, authorized: true, costingState: "not_needed" });
    return req;
  };

  it("exhausted needs_attention requests do not occupy the batch ahead of an actionable one, and are not rewritten", async () => {
    resetShared();
    const w = await lifeWorld([]);
    const dead = Array.from({ length: 8 }, (_, i) => exhausted(w.life, i + 1));
    const active = ((await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR })) as { value: { id: string } }).value.id;
    const r = await runRecovery(w.ports(), { lifecycle: 2 });
    expect(r.lifecycle).toMatchObject({ scanned: 9, due: 1, attempted: 1, completed: 1 });
    expect(w.life.w.requests.get(active)!.req.state).toBe("completed");
    for (const d of dead) expect(w.life.w.requests.get(d.id)!.req.version).toBe(3);
  });
  it("with more than two windows of held requests, a persisted cursor reaches the actionable one in a bounded cycle", async () => {
    resetShared();
    const w = await lifeWorld([]);
    for (let i = 1; i <= 8; i++) exhausted(w.life, i);
    const active = ((await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR })) as { value: { id: string } }).value.id;
    let truncated = false;
    let finishedAt = -1;
    // Start before the held prefix; DEV sorts before dev-x1, so it is visited only after wrapping.
    w.life.w.recoveryCursor = DEV;
    for (let pass = 0; pass < 4 && finishedAt < 0; pass++) {
      const r = await runRecovery(w.ports(), { scanLimit: 3, lifecycle: 2 });
      truncated ||= r.lifecycle.scanTruncated;
      expect(r.lifecycle.attempted).toBeLessThanOrEqual(2);
      if (w.life.w.requests.get(active)!.req.state === "completed") finishedAt = pass;
    }
    expect(truncated).toBe(true);
    expect(finishedAt).toBeGreaterThanOrEqual(0);
  });
  it("a LATE real StopTransaction makes an exhausted needs_attention request due again, without resetting its counters", async () => {
    resetShared();
    const w = await lifeWorld([]);
    const req = exhausted(w.life, 1);
    expect((await runRecovery(w.ports())).lifecycle.due).toBe(0);
    const t = w.life.w.txs.find((x) => x.deviceId === "dev-x1")!;
    t.stoppedReceivedAt = new Date(clock);
    const r = await runRecovery(w.ports());
    expect(r.lifecycle.due).toBe(1);
    const after = w.life.w.requests.get(req.id)!.req;
    expect(after.state).not.toBe("needs_attention");
    expect(after.sessions[0]!.stop.attempts).toBe(MAX_STOP_ATTEMPTS);
    expect(stopInputs).toHaveLength(0); // a stop is never fabricated or re-sent
  });
  it("API progress and duplicate recovery passes racing on one request use ONE stop attempt id (in-memory double; not PostgreSQL concurrency)", async () => {
    resetShared();
    const w = await lifeWorld([], { serialize: true });
    startSession(w.life);
    const id = ((await requestRemoval(w.deps(), { deviceId: DEV, kind: "remove", reason: "", requestKey: "k1", actor: ACTOR })) as { value: { id: string } }).value.id;
    await Promise.all([runRecovery(w.ports()), runRecovery(w.ports()), progressRemoval(w.deps(), id)]);
    // A redelivery of the SAME reserved attempt id is by design (the device returns its retained outcome and sends once);
    // what must never happen is a second attempt id.
    expect([...new Set(stopInputs.map((s) => s.attemptId))]).toEqual([`${id}:7:1`]);
    expect(stopInputs[0]).toMatchObject({ placementId: "p1" });
    expect(only(w.life).sessions[0]!.stop.attempts).toBe(1);
    expect(w.life.w.closed).toHaveLength(0);
  });
});

describe("scheduled composition", () => {
  const ports = (): RecoveryPorts => ({ costing: { run: async () => { throw new Error("db down"); }, recordFailure: async () => undefined }, lifecycle: null, stop: null });

  it("disabled (the default) opens nothing: zero database work", async () => {
    const open = vi.fn();
    for (const env of [{}, { CPO_SHELL_RECOVERY_ENABLED: "false" }, { CPO_SHELL_RECOVERY_ENABLED: "TRUE" }, { CPO_SHELL_RECOVERY_ENABLED: "1" }]) {
      expect(await runScheduledRecovery({ ...env, DATABASE_URL: "postgres://never.invalid/db" }, open)).toMatchObject({ status: "disabled", reason: "not_enabled" });
    }
    expect(open).not.toHaveBeenCalled();
  });
  it("enabled without a database reports unavailable, not an empty success", async () => {
    expect(await runScheduledRecovery({ CPO_SHELL_RECOVERY_ENABLED: "true" }, () => null)).toMatchObject({ status: "unavailable", reason: "database_not_configured" });
  });
  it("the client is closed after a pass, including when the database fails or the composition throws", async () => {
    const close = vi.fn(async () => undefined);
    expect(await runScheduledRecovery({ CPO_SHELL_RECOVERY_ENABLED: "true" }, () => ({ ports: ports(), close }))).toMatchObject({ status: "unavailable", reason: "database_error" });
    expect(close).toHaveBeenCalledTimes(1);
    // Nothing to cost, so the pass reaches the lifecycle port, whose construction throws: still unavailable, still closed.
    const empty: CostingStore = { run: async (fn) => fn({ claimOne: async () => null } as never), recordFailure: async () => undefined };
    const bad = { costing: empty, get lifecycle(): never { throw new Error("boom"); }, stop: null } as unknown as RecoveryPorts;
    const close2 = vi.fn(async () => undefined);
    expect((await runScheduledRecovery({ CPO_SHELL_RECOVERY_ENABLED: "true" }, () => ({ ports: bad, close: close2 }))).status).toBe("unavailable");
    expect(close2).toHaveBeenCalledTimes(1);
  });
});
