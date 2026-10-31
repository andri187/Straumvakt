import { describe, expect, it } from "vitest";
import type { ConnectionContext } from "./admission";
import type { AuthorizationFacts } from "./authorization";
import { SCHEMAS, validatePayload, rejectionForUnknownAction, isExercised } from "./protocol";
import { computeEnergy, handleAuthorize, handleStartTransaction, handleStopTransaction, MAX_PLAUSIBLE_TRANSACTION_WH } from "./transactions";
import { memoryTxStore } from "./__tests__/memory-tx-store";

const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ctxFor = (over: Partial<ConnectionContext> = {}): ConnectionContext => ({
  orgId: "11111111-1111-4111-8111-111111111111",
  installationId: INST,
  chargePointId: "CP-1",
  identityString: "abcdefghijk1/CP-1",
  deviceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  placementId: "p1",
  credentialMode: "none",
  credentialEpoch: "e1",
  ...over,
});
const good: AuthorizationFacts = { token: { id: "tok", userId: "usr", status: "active", expiresAt: null, scopeInstallationId: null }, userActive: true, hasInstallationAccess: true };
const facts = (tag: string): AuthorizationFacts => (tag === "GOOD" ? good : { token: null, userActive: false, hasInstallationAccess: false });
const T0 = new Date("2026-10-29T12:00:00Z");
const env = (m: ReturnType<typeof memoryTxStore>) => ({ store: m.store, now: () => T0 });

const start = (m: ReturnType<typeof memoryTxStore>, over: { messageId?: string; idTag?: string; connectorId?: number; meterStart?: number; ctx?: ConnectionContext; hash?: string } = {}) =>
  handleStartTransaction(env(m), {
    ctx: over.ctx ?? ctxFor(),
    messageId: over.messageId ?? "m1",
    requestHash: over.hash ?? `h-${over.messageId ?? "m1"}-${over.connectorId ?? 1}-${over.meterStart ?? 1000}`,
    payload: { connectorId: over.connectorId ?? 1, idTag: over.idTag ?? "GOOD", meterStart: over.meterStart ?? 1000, timestamp: "2026-10-29T12:00:00Z" },
    receivedAt: T0,
  });
const stop = (m: ReturnType<typeof memoryTxStore>, transactionId: number, meterStop: number, over: { messageId?: string; ctx?: ConnectionContext } = {}) =>
  handleStopTransaction(env(m), {
    ctx: over.ctx ?? ctxFor(),
    messageId: over.messageId ?? `s-${transactionId}`,
    requestHash: `hs-${over.messageId ?? transactionId}-${meterStop}`,
    payload: { transactionId, meterStop, timestamp: "2026-10-29T13:00:00Z" },
    receivedAt: new Date("2026-10-29T13:00:01Z"),
  });

describe("payload validation (exercised actions)", () => {
  it("accepts well-formed requests and refuses malformed ones with a protocol error, not an empty success", () => {
    expect(validatePayload("Authorize", { idTag: "ABC" }).ok).toBe(true);
    expect(validatePayload("Authorize", {})).toMatchObject({ ok: false, error: { code: "OccurenceConstraintViolation" } });
    expect(validatePayload("Authorize", { idTag: 5 })).toMatchObject({ ok: false, error: { code: "TypeConstraintViolation" } });
    expect(validatePayload("Authorize", { idTag: "x".repeat(21) })).toMatchObject({ ok: false, error: { code: "PropertyConstraintViolation" } });
    expect(validatePayload("Authorize", { idTag: "A", extra: 1 })).toMatchObject({ ok: false, error: { code: "FormationViolation" } });
    expect(validatePayload("StartTransaction", { connectorId: 0, idTag: "A", meterStart: 0, timestamp: "2026-10-29T12:00:00Z" })).toMatchObject({ ok: false });
    expect(validatePayload("StartTransaction", { connectorId: 1, idTag: "A", meterStart: -5, timestamp: "2026-10-29T12:00:00Z" })).toMatchObject({ ok: false });
    expect(validatePayload("StartTransaction", { connectorId: 1, idTag: "A", meterStart: 1.5, timestamp: "2026-10-29T12:00:00Z" })).toMatchObject({ ok: false });
    expect(validatePayload("StartTransaction", { connectorId: 1, idTag: "A", meterStart: 0, timestamp: "yesterday" })).toMatchObject({ ok: false });
    expect(validatePayload("StopTransaction", { transactionId: 1, meterStop: 5, timestamp: "2026-10-29T12:00:00Z", reason: "Bogus" })).toMatchObject({ ok: false });
    expect(validatePayload("StopTransaction", { transactionId: 1, meterStop: 5, timestamp: "2026-10-29T12:00:00Z", reason: "EVDisconnected" }).ok).toBe(true);
    expect(validatePayload("MeterValues", { connectorId: 1, meterValue: [] })).toMatchObject({ ok: false });
    expect(validatePayload("MeterValues", { connectorId: 1, meterValue: [{ timestamp: "2026-10-29T12:00:00Z", sampledValue: [{ value: "10", measurand: "Energy.Active.Import.Register", unit: "Wh" }] }] }).ok).toBe(true);
    expect(validatePayload("BootNotification", { chargePointVendor: "V", chargePointModel: "M" }).ok).toBe(true);
    expect(validatePayload("BootNotification", { chargePointVendor: "V" })).toMatchObject({ ok: false });
    expect(validatePayload("StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging" }).ok).toBe(true);
    expect(validatePayload("StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Exploding" })).toMatchObject({ ok: false });
    expect(validatePayload("Heartbeat", {}).ok).toBe(true);
    expect(validatePayload("Heartbeat", { x: 1 })).toMatchObject({ ok: false });
  });
  it("covers every exercised action and answers anything else NotImplemented", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(["Authorize", "BootNotification", "Heartbeat", "MeterValues", "StartTransaction", "StatusNotification", "StopTransaction"]);
    expect(isExercised("Reset")).toBe(false);
    expect(rejectionForUnknownAction("Reset").code).toBe("NotImplemented");
    expect(rejectionForUnknownAction("DataTransfer").description).toMatch(/not yet handled/);
  });
});

describe("energy from registers", () => {
  it("computes consumption only from a consistent start/stop pair", () => {
    expect(computeEnergy(1000, 6000)).toEqual({ energyWh: 5000, quality: "ok" });
    expect(computeEnergy(1000, 1000)).toEqual({ energyWh: 0, quality: "ok" });
    expect(computeEnergy(1000, null)).toEqual({ energyWh: null, quality: "missing_stop" });
    expect(computeEnergy(5000, 100)).toEqual({ energyWh: null, quality: "register_decreased" });
    expect(computeEnergy(0, MAX_PLAUSIBLE_TRANSACTION_WH + 1)).toEqual({ energyWh: null, quality: "implausible" });
    expect(computeEnergy(1.5, 10)).toEqual({ energyWh: null, quality: "unparseable" });
  });
});

describe("Authorize", () => {
  it("persists receipt, decision and response together, and answers a retransmission identically without re-deciding", async () => {
    const m = memoryTxStore({ facts });
    const req = { ctx: ctxFor(), messageId: "a1", requestHash: "ha1", payload: { idTag: "GOOD" }, receivedAt: T0 };
    expect(await handleAuthorize(env(m), req)).toEqual({ kind: "reply", payload: { idTagInfo: { status: "Accepted" } } });
    expect(m.state.receipts).toHaveLength(1);
    expect(m.state.receipts[0]).toMatchObject({ decision: { status: "Accepted", reason: "ok" }, response: { idTagInfo: { status: "Accepted" } } });
    const readsBefore = m.stats.reads;
    expect(await handleAuthorize(env(m), req)).toEqual({ kind: "reply", payload: { idTagInfo: { status: "Accepted" } } });
    expect(m.stats.reads).toBe(readsBefore);
    expect(m.state.receipts).toHaveLength(1);
    expect(m.state.txs).toHaveLength(0); // Authorize never creates a session
  });
  it("keeps refusal evidence and never accepts a fixed vendor test tag", async () => {
    const m = memoryTxStore({ facts });
    const r = await handleAuthorize(env(m), { ctx: ctxFor(), messageId: "a2", requestHash: "ha2", payload: { idTag: "EE43C609263CC7" }, receivedAt: T0 });
    expect(r).toEqual({ kind: "reply", payload: { idTagInfo: { status: "Invalid" } } });
    expect(m.state.receipts[0]).toMatchObject({ decision: { status: "Invalid", reason: "unknown_id_tag" } });
  });
  it("answers unavailable (no fabricated decision) when authorization cannot be read, and writes nothing", async () => {
    const m = memoryTxStore({ facts, failRead: () => true });
    const r = await handleAuthorize(env(m), { ctx: ctxFor(), messageId: "a3", requestHash: "ha3", payload: { idTag: "GOOD" }, receivedAt: T0 });
    expect(r).toEqual({ kind: "unavailable" });
    expect(m.state.receipts).toHaveLength(0);
  });
});

describe("StartTransaction", () => {
  it("assigns a durable id with sealed context before replying, and a duplicate returns the same id", async () => {
    const m = memoryTxStore({ facts });
    const a = await start(m);
    expect(a).toEqual({ kind: "reply", payload: { transactionId: 1, idTagInfo: { status: "Accepted" } } });
    expect(m.state.txs[0]).toMatchObject({ transactionNo: 1, orgId: ctxFor().orgId, installationId: INST, deviceId: ctxFor().deviceId, placementId: "p1", authorized: true, connectorNo: 1 });
    const b = await start(m); // charger retransmits the same Call
    expect(b).toEqual(a);
    expect(m.state.txs).toHaveLength(1);
  });
  it("does not collapse distinct requests that reuse a wire message id", async () => {
    const m = memoryTxStore({ facts });
    const a = await start(m, { messageId: "same", connectorId: 1, meterStart: 100 });
    const b = await start(m, { messageId: "same", connectorId: 2, meterStart: 200 });
    expect((a as { payload: { transactionId: number } }).payload.transactionId).not.toBe((b as { payload: { transactionId: number } }).payload.transactionId);
    expect(m.state.txs).toHaveLength(2);
  });
  it("creates an unauthorized transaction row for a refused start, replying with the refusal", async () => {
    const m = memoryTxStore({ facts });
    const r = await start(m, { idTag: "NOPE" });
    expect(r).toEqual({ kind: "reply", payload: { transactionId: 1, idTagInfo: { status: "Invalid" } } });
    expect(m.state.txs[0]).toMatchObject({ authorized: false });
  });
  it("two connectors run and stop independently", async () => {
    const m = memoryTxStore({ facts });
    const a = (await start(m, { messageId: "c1", connectorId: 1, meterStart: 100 })) as { payload: { transactionId: number } };
    const b = (await start(m, { messageId: "c2", connectorId: 2, meterStart: 5000 })) as { payload: { transactionId: number } };
    await stop(m, b.payload.transactionId, 5400);
    const [t1, t2] = m.state.txs;
    expect(t1!.stoppedAt).toBeNull();
    expect(t2).toMatchObject({ meterStopWh: 5400, costingState: "needed" });
    await stop(m, a.payload.transactionId, 900);
    expect(m.state.txs[0]).toMatchObject({ meterStopWh: 900, energyWh: 800 });
  });
  it("a new start on a busy connector flags the older transaction for reconciliation and closes nothing", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { messageId: "x1", meterStart: 100 });
    await start(m, { messageId: "x2", meterStart: 300 });
    expect(m.state.txs[0]).toMatchObject({ stoppedAt: null, reconcileFlag: "superseded_by_new_start" });
    expect(m.state.txs[1]).toMatchObject({ stoppedAt: null, reconcileFlag: null });
  });
  it("is atomic: a write failure after the receipt leaves no receipt, no transaction and no consumed id", async () => {
    let fail = true;
    const m = memoryTxStore({ facts, failWriteAfterReceipt: () => fail });
    expect(await start(m)).toEqual({ kind: "unavailable" });
    expect(m.state.receipts).toHaveLength(0);
    expect(m.state.txs).toHaveLength(0);
    fail = false;
    expect(await start(m)).toMatchObject({ kind: "reply", payload: { transactionId: 1 } });
  });
  it("refuses to wrap or reuse ids when the 32-bit space is exhausted", async () => {
    const m = memoryTxStore({ facts, maxSeq: 2 });
    await start(m, { messageId: "e1", meterStart: 1 });
    await start(m, { messageId: "e2", connectorId: 2, meterStart: 2 });
    expect(await start(m, { messageId: "e3", connectorId: 3, meterStart: 3 })).toEqual({ kind: "unavailable" });
    expect(m.state.txs).toHaveLength(2);
  });
  it("reports unavailable if authorization cannot be read, creating nothing", async () => {
    const m = memoryTxStore({ facts, failRead: () => true });
    expect(await start(m)).toEqual({ kind: "unavailable" });
    expect(m.state.txs).toHaveLength(0);
  });
});

describe("StopTransaction", () => {
  it("records stop readings, computes energy and publishes a durable costing-needed outcome", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 1000 });
    expect(await stop(m, 1, 7000)).toEqual({ kind: "reply", payload: {} });
    expect(m.state.txs[0]).toMatchObject({ meterStartWh: 1000, meterStopWh: 7000, energyWh: 6000, energyQuality: "ok", costingState: "needed" });
  });
  it("a register that went backwards keeps both raw readings, yields no energy, and blocks costing instead of pricing zero", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 90000 });
    await stop(m, 1, 120);
    expect(m.state.txs[0]).toMatchObject({ meterStartWh: 90000, meterStopWh: 120, energyWh: null, energyQuality: "register_decreased", costingState: "blocked_energy" });
  });
  it("unauthorized energy is retained as evidence and excluded from ordinary costing", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { idTag: "NOPE", meterStart: 0 });
    await stop(m, 1, 4000);
    expect(m.state.txs[0]).toMatchObject({ authorized: false, meterStopWh: 4000, energyWh: 4000, costingState: "excluded_unauthorized" });
  });
  it("a duplicate stop is idempotent; a conflicting later stop keeps the first and is flagged", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 0 });
    await stop(m, 1, 1000, { messageId: "s1" });
    await stop(m, 1, 1000, { messageId: "s1" }); // retransmission, same hash
    expect(m.state.receipts.filter((r) => r.action === "StopTransaction")).toHaveLength(1);
    await stop(m, 1, 9999, { messageId: "s2" }); // different reading
    expect(m.state.txs[0]).toMatchObject({ meterStopWh: 1000, reconcileFlag: "conflicting_stop" });
  });
  it("an unknown transaction id is quarantined with its evidence, not discarded", async () => {
    const m = memoryTxStore({ facts });
    expect(await stop(m, 4242, 10)).toEqual({ kind: "reply", payload: {} });
    expect(m.state.quarantine).toEqual([expect.objectContaining({ reason: "stop_unknown_transaction", transactionNo: 4242 })]);
  });
  it("a transaction id belonging to another device is quarantined and does not touch that transaction", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 0 });
    const intruder = ctxFor({ deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    await stop(m, 1, 500, { ctx: intruder });
    expect(m.state.txs[0]).toMatchObject({ stoppedAt: null, meterStopWh: null });
    expect(m.state.quarantine[0]).toMatchObject({ reason: "stop_for_other_device" });
  });
  it("after the device moves, a late stop still lands in the ORIGINAL tenant's transaction and the charger's timestamp cannot change it", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 0 });
    const moved = ctxFor({ orgId: "99999999-9999-4999-8999-999999999999", installationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", placementId: "p-new" });
    await handleStopTransaction(env(m), {
      ctx: moved,
      messageId: "late",
      requestHash: "hl",
      payload: { transactionId: 1, meterStop: 2500, timestamp: "2001-01-01T00:00:00Z" }, // absurd charger clock
      receivedAt: new Date("2026-10-30T00:00:00Z"),
    });
    expect(m.state.txs[0]).toMatchObject({ orgId: ctxFor().orgId, installationId: INST, placementId: "p1", meterStopWh: 2500, energyWh: 2500 });
  });
  it("delayed stop-before-observed-start converges: the stop is quarantined, the later start gets a fresh id and is not closed by it", async () => {
    const m = memoryTxStore({ facts });
    await stop(m, 1, 800); // stop arrives for an id we have not issued yet
    const s = (await start(m, { meterStart: 0 })) as { payload: { transactionId: number } };
    expect(s.payload.transactionId).toBe(1);
    expect(m.state.txs[0]!.stoppedAt).toBeNull(); // the quarantined early stop did NOT close it
    expect(m.state.quarantine).toHaveLength(1); // and remains recoverable for reconciliation
  });
});

import { handleMeterValues, readingsFrom } from "./meter";

describe("MeterValues", () => {
  const mv = (transactionId: number | undefined, wh: string, ts = "2026-10-29T12:30:00Z", unit = "Wh") => ({
    connectorId: 1,
    ...(transactionId === undefined ? {} : { transactionId }),
    meterValue: [{ timestamp: ts, sampledValue: [{ value: wh, measurand: "Energy.Active.Import.Register", unit }, { value: "7200", measurand: "Power.Active.Import", unit: "W" }, { value: "16.1", measurand: "Current.Import", phase: "L1", unit: "A" }] }],
  });
  const feed = (m: ReturnType<typeof memoryTxStore>, payload: ReturnType<typeof mv>, hash = "mh") => handleMeterValues(env(m), { ctx: ctxFor(), payload, receivedAt: T0, requestHash: hash, messageId: "mm" });

  it("extracts the energy register and power; keeps every other sample verbatim", () => {
    const [r] = readingsFrom(mv(1, "1500"));
    expect(r).toMatchObject({ energyWh: 1500, powerW: 7200, other: { "Current.Import.L1": { value: "16.1", unit: "A" } } });
    expect(readingsFrom(mv(1, "1.5", undefined, "kWh"))[0]!.energyWh).toBe(1500);
  });
  it("never invents energy from an unreadable value or unknown unit; the raw sample is kept", () => {
    const bad = readingsFrom(mv(1, "n/a"))[0]!;
    expect(bad.energyWh).toBeNull();
    expect(bad.other["Energy.Active.Import.Register"]).toMatchObject({ value: "n/a" });
    expect(readingsFrom(mv(1, "5", undefined, "J"))[0]!.energyWh).toBeNull();
  });
  it("is idempotent when the same message is redelivered, and out-of-order delivery converges", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 0 });
    expect(await feed(m, mv(1, "200", "2026-10-29T12:20:00Z"), "a")).toEqual({ kind: "applied", inserted: 1 });
    expect(await feed(m, mv(1, "100", "2026-10-29T12:10:00Z"), "b")).toEqual({ kind: "applied", inserted: 1 }); // older arrives later
    expect(await feed(m, mv(1, "200", "2026-10-29T12:20:00Z"), "a")).toEqual({ kind: "applied", inserted: 0 }); // redelivery
    expect(m.state.readings.map((r) => r.energyWh).sort()).toEqual([100, 200]);
  });
  it("a late reading after the stop is still kept as evidence", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 0 });
    await stop(m, 1, 900);
    expect(await feed(m, mv(1, "950", "2026-10-29T13:05:00Z"))).toEqual({ kind: "applied", inserted: 1 });
  });
  it("quarantines readings for an unknown transaction or another device; ignores transaction-less telemetry", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 0 });
    expect(await feed(m, mv(77, "1"))).toEqual({ kind: "quarantined", reason: "meter_unknown_transaction" });
    const other = await handleMeterValues(env(m), { ctx: ctxFor({ deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }), payload: mv(1, "1"), receivedAt: T0, requestHash: "z", messageId: "zz" });
    expect(other).toEqual({ kind: "quarantined", reason: "meter_for_other_device" });
    expect(await feed(m, mv(undefined, "1"))).toEqual({ kind: "ignored_no_transaction" });
    expect(m.state.readings).toHaveLength(0);
  });
});

describe("charger removal in progress (start-block)", () => {
  const blocked = () => memoryTxStore({ facts, blockedDevices: new Set([ctxFor().deviceId]) });

  it("refuses Authorize for a valid driver with Blocked and records why", async () => {
    const m = blocked();
    const r = await handleAuthorize(env(m), { ctx: ctxFor(), messageId: "b1", requestHash: "hb1", payload: { idTag: "GOOD" }, receivedAt: T0 });
    expect(r).toEqual({ kind: "reply", payload: { idTagInfo: { status: "Blocked" } } });
    expect(m.state.receipts[0]!.decision).toMatchObject({ status: "Blocked", reason: "service_blocked_removal" });
  });
  it("refuses StartTransaction but keeps the attempt as unauthorized evidence, never costed", async () => {
    const m = blocked();
    const r = await start(m);
    expect(r).toEqual({ kind: "reply", payload: { transactionId: 1, idTagInfo: { status: "Blocked" } } });
    expect(m.state.txs[0]).toMatchObject({ authorized: false });
  });
  it("does NOT block stop or meter evidence: the session being ended must still be able to finish", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 100 }); // started before the block
    const b = blocked();
    b.state.txs.push(...structuredClone(m.state.txs));
    expect(await stop(b, 1, 900)).toEqual({ kind: "reply", payload: {} });
    expect(b.state.txs[0]).toMatchObject({ meterStopWh: 900, energyWh: 800, costingState: "needed" });
  });
  it("an unblocked device is unaffected", async () => {
    expect(await start(memoryTxStore({ facts }))).toMatchObject({ payload: { idTagInfo: { status: "Accepted" } } });
  });
});

describe("start gate: a closed placement and a stale admitted socket", () => {
  const closed = (log?: string[]) => memoryTxStore({ facts, closedPlacements: new Set([ctxFor().placementId]), ...(log ? { gateLog: log } : {}) });

  it("a start from a socket admitted BEFORE the placement closed is refused (placement_closed), recorded as unauthorized evidence, never costed", async () => {
    const m = closed();
    const r = await start(m);
    expect(r).toEqual({ kind: "reply", payload: { transactionId: 1, idTagInfo: { status: "Blocked" } } });
    expect(m.state.txs[0]).toMatchObject({ authorized: false });
    expect(m.state.receipts[0]!.decision).toMatchObject({ status: "Blocked", reason: "placement_closed" });
  });
  it("Authorize is refused the same way, so the charger's display does not invite a start", async () => {
    const m = closed();
    const r = await handleAuthorize(env(m), { ctx: ctxFor(), messageId: "g1", requestHash: "hg1", payload: { idTag: "GOOD" }, receivedAt: T0 });
    expect(r).toEqual({ kind: "reply", payload: { idTagInfo: { status: "Blocked" } } });
    expect(m.state.receipts[0]!.decision).toMatchObject({ reason: "placement_closed" });
  });
  it("the gate runs exactly once per start, inside the transaction that inserts it (before the insert)", async () => {
    const log: string[] = [];
    const m = memoryTxStore({ facts, gateLog: log });
    await start(m);
    expect(log).toEqual([`gate:${ctxFor().placementId}`]);
    expect(m.stats.runs).toBe(1);
  });
  it("a retransmitted start replays the stored answer WITHOUT re-taking the gate or re-deciding", async () => {
    const log: string[] = [];
    const m = memoryTxStore({ facts, gateLog: log });
    const a = await start(m);
    const b = await start(m);
    expect(b).toEqual(a);
    expect(log).toHaveLength(1);
  });
  it("a late stop and late meter for a session that began BEFORE the close are still accepted on the old placement", async () => {
    const m = memoryTxStore({ facts });
    await start(m, { meterStart: 10 });
    const c = closed();
    c.state.txs.push(...structuredClone(m.state.txs));
    expect(await stop(c, 1, 510)).toEqual({ kind: "reply", payload: {} });
    expect(c.state.txs[0]).toMatchObject({ meterStopWh: 510, energyWh: 500, costingState: "needed", placementId: "p1" });
  });
});

describe("terms snapshot at start", () => {
  const clause = { costFactorId: "f1", costFactorCode: "energy", defaultBearerType: "usr" as const, defaultBearerRef: null, defaultRateRefCode: "E", allocation: { passthrough: { splits: [{ bearer_type: "usr" as const, share_pct: 100 }] }, markup: null } };
  const terms = () => ({ installationAgreementId: "agr1", driverGroup: { id: "g1", ownerOrgId: "o1" }, clauses: [clause], rules: [], rateReferences: [{ id: "rr", code: "E", costFactorId: "f1", basis: "per_kwh" as const, priceMinor: 2000n, vatRatePct: 24, currency: "ISK", supplierOrgId: null, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: null }] });

  it("captures the applicable terms ONCE at start for an accepted driver and stores them on the transaction, content-addressed", async () => {
    const log: string[] = [];
    const m = memoryTxStore({ facts, terms, captureLog: log });
    await start(m);
    expect(log).toEqual(["usr"]);
    const snap = (m.state.txs[0] as unknown as { termsSnapshot: { status: string; at: string; sha256: string; facts: { installationAgreementId: string } } }).termsSnapshot;
    expect(snap).toMatchObject({ status: "captured", at: T0.toISOString(), facts: { installationAgreementId: "agr1" } });
    expect(snap.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("a retransmitted start does not capture again and returns the stored answer", async () => {
    const log: string[] = [];
    const m = memoryTxStore({ facts, terms, captureLog: log });
    await start(m);
    await start(m);
    expect(log).toHaveLength(1);
  });
  it("is NOT captured for refused, unauthorized or removal-blocked starts (they are never costed)", async () => {
    const log: string[] = [];
    await start(memoryTxStore({ facts, terms, captureLog: log }), { idTag: "NOPE" });
    const blockedStore = memoryTxStore({ facts, terms, captureLog: log, blockedDevices: new Set([ctxFor().deviceId]) });
    await start(blockedStore);
    expect(log).toEqual(["usr"]); // only the blocked one was an accepted driver: captured before the gate, but then discarded
    expect((blockedStore.state.txs[0] as unknown as { termsSnapshot: unknown }).termsSnapshot).toBeNull();
    expect((memoryTxStore({ facts, terms }).state.txs).length).toBe(0);
  });
  it("a capture failure never blocks charging: the start is accepted and the snapshot honestly says the terms were not captured", async () => {
    const m = memoryTxStore({ facts, terms, failCapture: () => true });
    expect(await start(m)).toMatchObject({ payload: { idTagInfo: { status: "Accepted" } } });
    expect((m.state.txs[0] as unknown as { termsSnapshot: { status: string; reason: string } }).termsSnapshot).toMatchObject({ status: "missing", reason: "capture_failed" });
  });
  it("a store without term capture records 'capture_not_available' rather than inventing terms", async () => {
    const m = memoryTxStore({ facts });
    await start(m);
    expect((m.state.txs[0] as unknown as { termsSnapshot: { status: string; reason: string } }).termsSnapshot).toMatchObject({ status: "missing", reason: "capture_not_available" });
  });
});
