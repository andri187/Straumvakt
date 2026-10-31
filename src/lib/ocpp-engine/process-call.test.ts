import { describe, expect, it } from "vitest";
import type { ConnectionContext } from "./admission";
import type { AuthorizationFacts } from "./authorization";
import { canonicalJson, processCall } from "./process-call";
import { memoryTxStore } from "./__tests__/memory-tx-store";

const ctx: ConnectionContext = {
  orgId: "11111111-1111-4111-8111-111111111111",
  installationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  chargePointId: "CP-1",
  identityString: "abcdefghijk1/CP-1",
  deviceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  placementId: "p1",
  credentialMode: "none",
  credentialEpoch: "e1",
};
const good: AuthorizationFacts = { token: { id: "tok", userId: "usr", status: "active", expiresAt: null, scopeInstallationId: null }, userActive: true, hasInstallationAccess: true };
const T = new Date("2026-10-29T12:00:00Z");
const mk = (over: Parameters<typeof memoryTxStore>[0] = {}) => {
  const m = memoryTxStore({ facts: (t) => (t === "GOOD" ? good : { token: null, userActive: false, hasInstallationAccess: false }), ...over });
  return { m, env: { store: m.store, heartbeatIntervalSeconds: 3600, now: () => T } };
};
const call = (action: string, payload: unknown, messageId = "m1") => ({ ctx, messageId, action, payload, receivedAt: T });

describe("processCall: one generic path", () => {
  it("records reported equipment details without SIM identifiers or granting charging permission", async () => {
    const { m, env } = mk();
    const boot = call("BootNotification", { chargePointVendor: "AnyMaker", chargePointModel: "X1", chargePointSerialNumber: "serial-1", firmwareVersion: "1.2", iccid: "private-sim" });
    expect(await processCall(env, boot)).toEqual({ kind: "result", payload: { status: "Accepted", currentTime: T.toISOString(), interval: 3600 } });
    expect(await processCall(env, boot)).toEqual({ kind: "result", payload: { status: "Accepted", currentTime: T.toISOString(), interval: 3600 } });
    expect(m.state.receipts).toHaveLength(1);
    expect(m.state.receipts[0].payload).toEqual({ chargePointVendor: "AnyMaker", chargePointModel: "X1", chargePointSerialNumber: "serial-1", firmwareVersion: "1.2" });
    expect(m.state.txs).toHaveLength(0);
  });
  it("does not acknowledge a boot when storing its evidence fails", async () => {
    const { env } = mk();
    const bad = { ...env, store: { ...env.store, run: async () => { throw new Error("db"); } } };
    expect(await processCall(bad, call("BootNotification", { chargePointVendor: "AnyMaker", chargePointModel: "X1" }))).toMatchObject({ kind: "error", code: "InternalError" });
  });
  it("rejects malformed payloads with a protocol error instead of a successful empty reply", async () => {
    const { env } = mk();
    expect(await processCall(env, call("Authorize", {}))).toMatchObject({ kind: "error", code: "OccurenceConstraintViolation" });
    expect(await processCall(env, call("StartTransaction", { connectorId: 1, idTag: "GOOD", meterStart: "x", timestamp: "2026-10-29T12:00:00Z" }))).toMatchObject({ kind: "error", code: "TypeConstraintViolation" });
  });
  it("answers unsupported and deferred actions NotImplemented, never a blanket success", async () => {
    const { env } = mk();
    expect(await processCall(env, call("Reset", { type: "Soft" }))).toMatchObject({ kind: "error", code: "NotImplemented" });
    expect(await processCall(env, call("DataTransfer", { vendorId: "x" }))).toMatchObject({ kind: "error", code: "NotImplemented" });
  });
  it("runs start -> meter -> stop through the same path, and a retransmitted start returns the same transaction id", async () => {
    const { m, env } = mk();
    const startPayload = { connectorId: 1, idTag: "GOOD", meterStart: 1000, timestamp: "2026-10-29T12:00:00Z" };
    const a = await processCall(env, call("StartTransaction", startPayload, "s1"));
    const b = await processCall(env, call("StartTransaction", { timestamp: "2026-10-29T12:00:00Z", meterStart: 1000, idTag: "GOOD", connectorId: 1 }, "s1")); // reordered keys
    expect(a).toEqual({ kind: "result", payload: { transactionId: 1, idTagInfo: { status: "Accepted" } } });
    expect(b).toEqual(a);
    expect(await processCall(env, call("MeterValues", { connectorId: 1, transactionId: 1, meterValue: [{ timestamp: "2026-10-29T12:10:00Z", sampledValue: [{ value: "3000" }] }] }, "mv1"))).toEqual({ kind: "result", payload: {} });
    expect(await processCall(env, call("StopTransaction", { transactionId: 1, meterStop: 5000, timestamp: "2026-10-29T13:00:00Z" }, "x1"))).toEqual({ kind: "result", payload: {} });
    expect(m.state.txs[0]).toMatchObject({ energyWh: 4000, costingState: "needed" });
    expect(m.state.readings).toHaveLength(1);
  });
  it("maps a backend outage to a retryable CALLERROR, never to an invented decision", async () => {
    const { env } = mk({ failRead: () => true });
    expect(await processCall(env, call("Authorize", { idTag: "GOOD" }))).toEqual({ kind: "error", code: "InternalError", description: "backend unavailable; retry" });
    expect(await processCall(env, call("StartTransaction", { connectorId: 1, idTag: "GOOD", meterStart: 0, timestamp: "2026-10-29T12:00:00Z" }))).toMatchObject({ kind: "error", code: "InternalError" });
  });
  it("hashes requests independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
  });
});

describe("StatusNotification", () => {
  const st = (id: string, status: string, ts?: string) => call("StatusNotification", { connectorId: 1, errorCode: "NoError", status, ...(ts ? { timestamp: ts } : {}) }, id);
  it("writes only a CHANGED connector state and bumps the installation counter once per change", async () => {
    const { m, env } = mk();
    await processCall(env, st("s1", "Available"));
    await processCall(env, st("s2", "Available")); // repeat: nothing
    await processCall(env, st("s3", "Charging"));
    await processCall(env, st("s4", "Charging"));
    expect(m.state.statusVersion[ctx.installationId]).toBe(2);
    expect(m.state.devices[ctx.deviceId]).toMatchObject({ seq: 2, connectors: { "1": { status: "Charging" } } });
  });
  it("an older update (by the charger's timestamp) never regresses state", async () => {
    const { m, env } = mk();
    await processCall(env, st("a", "Charging", "2026-10-29T12:05:00Z"));
    await processCall(env, st("b", "Preparing", "2026-10-29T12:00:00Z")); // delayed, older
    expect(m.state.devices[ctx.deviceId]!.connectors["1"]!.status).toBe("Charging");
    expect(m.state.statusVersion[ctx.installationId]).toBe(1);
  });
  it("a backend failure is surfaced for retry, not acknowledged as stored", async () => {
    const { env } = mk({ failWriteAfterReceipt: () => false });
    const bad = { ...env, store: { ...env.store, run: async () => { throw new Error("db"); } } };
    expect(await processCall(bad, st("x", "Faulted"))).toMatchObject({ kind: "error", code: "InternalError" });
  });
});
