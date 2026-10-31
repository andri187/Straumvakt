import { describe, expect, it } from "vitest";
import type { AdmissionLookup, AdmissionStore } from "./admission";
import type { AuthorizationFacts } from "./authorization";
import { memoryTxStore } from "./__tests__/memory-tx-store";
import { heartbeatSeconds } from "./live";
import { MAX_PAYLOAD_JSON_BYTES, rpcAdmit, rpcCall, type EngineRpcDeps } from "./rpc";

const T = new Date("2026-10-30T09:00:00Z");
const OLD_KEY = "abcdefghijk1"; // the retired URL form's installation segment
const lookup: AdmissionLookup = {
  org: { id: "o1", active: true },
  identities: [
    {
      deviceId: "dev1",
      chargePointId: "CP-1",
      identityString: "o1/CP-1",
      current: true,
      placements: [{ id: "p1", orgId: "o1", installationId: "i1", current: true, installation: { id: "i1", orgId: "o1", archived: false, passwordMode: "none", passwordVerifier: null, credentialEpoch: "e1" } }],
    },
  ],
};
const good: AuthorizationFacts = { token: { id: "t", userId: "u", status: "active", expiresAt: null, scopeInstallationId: null }, userActive: true, hasInstallationAccess: true };
const ctx = { orgId: "o1", installationId: "i1", chargePointId: "CP-1", identityString: "o1/CP-1", deviceId: "dev1", placementId: "p1", credentialMode: "none", credentialEpoch: "e1" };

function deps(over: Partial<EngineRpcDeps> = {}, opts: { failLookup?: boolean; mem?: ReturnType<typeof memoryTxStore> } = {}): EngineRpcDeps {
  const mem = opts.mem ?? memoryTxStore({ facts: () => good });
  const store: AdmissionStore = { lookup: async () => { if (opts.failLookup) throw new Error("db"); return lookup; }, recordDiscovery: async () => undefined };
  return { now: () => T, heartbeatIntervalSeconds: 3600, withAdmission: async (fn) => fn(store), withEngine: async (fn) => fn({ store: mem.store }), ...over };
}
const call = (over: Record<string, unknown> = {}) => ({ ctx, messageId: "m1", action: "Authorize", payload: { idTag: "T" }, receivedAt: T.toISOString(), ...over });

describe("rpcAdmit", () => {
  it("returns the resolved context for a registered device", async () => {
    expect(await rpcAdmit(deps(), { host: "cpoa.straumvakt.org", pathname: "/CP-1", authorization: null })).toMatchObject({ kind: "admit", context: { deviceId: "dev1", placementId: "p1", installationId: "i1" } });
  });
  it("denies malformed input, foreign hosts and every refusal identically", async () => {
    const bad = [null, {}, { host: 5, pathname: "/x" }, { host: "evil.example.com", pathname: "/CP-1" }, { host: "cpoa.straumvakt.org", pathname: `/CP-1/x` }];
    for (const b of bad) expect(await rpcAdmit(deps(), b)).toEqual({ kind: "deny" });
    const none = deps({ withAdmission: async (fn) => fn({ lookup: async () => ({ ...lookup, identities: [] }), recordDiscovery: async () => undefined }) });
    expect(await rpcAdmit(none, { host: "cpoa.straumvakt.org", pathname: "/CP-1" })).toEqual({ kind: "deny" });
  });
  it("reports unavailable when the database is down or not configured, never admit", async () => {
    expect(await rpcAdmit(deps({}, { failLookup: true }), { host: "cpoa.straumvakt.org", pathname: "/CP-1" })).toEqual({ kind: "unavailable" });
    expect(await rpcAdmit(deps({ withAdmission: async () => null }), { host: "cpoa.straumvakt.org", pathname: "/CP-1" })).toEqual({ kind: "unavailable" });
    expect(await rpcAdmit(deps({ withAdmission: async () => { throw new Error("boom"); } }), { host: "cpoa.straumvakt.org", pathname: "/CP-1" })).toEqual({ kind: "unavailable" });
  });
  it("password mode reaches the verifier: no header is refused", async () => {
    const w = deps({ withAdmission: async (fn) => fn({ lookup: async () => ({ ...lookup, identities: lookup.identities.map((i) => ({ ...i, placements: i.placements.map((p) => ({ ...p, installation: { ...p.installation!, passwordMode: "password" as const, passwordVerifier: "x" } })) })) }), recordDiscovery: async () => undefined }) });
    expect(await rpcAdmit(w, { host: "cpoa.straumvakt.org", pathname: "/CP-1", authorization: null })).toEqual({ kind: "deny" });
    // The retired /{installation-key}/{charge-point-id} form is refused outright.
    expect(await rpcAdmit(deps(), { host: "cpoa.straumvakt.org", pathname: `/${OLD_KEY}/CP-1`, authorization: null })).toEqual({ kind: "deny" });
  });
});

describe("rpcCall", () => {
  it("runs the generic path", async () => {
    const mem = memoryTxStore({ facts: () => good });
    expect(await rpcCall(deps({}, { mem }), call({ action: "StartTransaction", payload: { connectorId: 1, idTag: "T", meterStart: 5, timestamp: "2026-10-30T09:00:00Z" } }))).toEqual({
      kind: "answer", answer: { kind: "result", payload: { transactionId: 1, idTagInfo: { status: "Accepted" } } },
    });
  });
  it("a protocol refusal is an answer; a backend failure is `unavailable` so the gateway retries", async () => {
    expect(await rpcCall(deps(), call({ payload: {} }))).toMatchObject({ kind: "answer", answer: { kind: "error", code: "OccurenceConstraintViolation" } });
    expect(await rpcCall(deps({}, { mem: memoryTxStore({ facts: () => good, failRead: () => true }) }), call())).toEqual({ kind: "unavailable" });
    expect(await rpcCall(deps({ withEngine: async () => null }), call())).toEqual({ kind: "unavailable" });
    expect(await rpcCall(deps({ withEngine: async () => { throw new Error("x"); } }), call())).toEqual({ kind: "unavailable" });
  });
  it("rejects a forged or incomplete context and oversize payloads as permanent (poison), not retryable", async () => {
    expect(await rpcCall(deps(), call({ ctx: { orgId: "o1" } }))).toEqual({ kind: "rejected", status: 400 });
    expect(await rpcCall(deps(), call({ ctx: { ...ctx, credentialMode: "any" } }))).toEqual({ kind: "rejected", status: 400 });
    expect(await rpcCall(deps(), call({ receivedAt: "nope" }))).toEqual({ kind: "rejected", status: 400 });
    expect(await rpcCall(deps(), call({ messageId: "" }))).toEqual({ kind: "rejected", status: 400 });
    expect(await rpcCall(deps(), call({ payload: { idTag: "x".repeat(MAX_PAYLOAD_JSON_BYTES) } }))).toEqual({ kind: "rejected", status: 413 });
    expect(await rpcCall(deps(), "string")).toEqual({ kind: "rejected", status: 400 });
  });
});

describe("costing trigger after a stop", () => {
  const stop = (mem: ReturnType<typeof memoryTxStore>, extra: Partial<EngineRpcDeps>) =>
    rpcCall(deps(extra, { mem }), call({ messageId: "s1", action: "StopTransaction", payload: { transactionId: 1, meterStop: 10, timestamp: "2026-10-30T10:00:00Z" } }));
  const started = async () => {
    const mem = memoryTxStore({ facts: () => good });
    await rpcCall(deps({}, { mem }), call({ messageId: "b1", action: "StartTransaction", payload: { connectorId: 1, idTag: "T", meterStart: 0, timestamp: "2026-10-30T09:00:00Z" } }));
    return mem;
  };
  it("fires once after a stop result, and never for other actions", async () => {
    let n = 0;
    const mem = await started();
    await stop(mem, { afterStop: () => { n++; } });
    await rpcCall(deps({ afterStop: () => { n++; } }), call());
    expect(n).toBe(1);
  });
  it("a throwing trigger cannot change the charger's reply", async () => {
    const mem = await started();
    expect(await stop(mem, { afterStop: () => { throw new Error("boom"); } })).toEqual({ kind: "answer", answer: { kind: "result", payload: {} } });
  });
  it("is not fired when the stop could not be recorded (retryable outage)", async () => {
    let n = 0;
    const down = memoryTxStore({ facts: () => good });
    await rpcCall(deps({ withEngine: async () => null, afterStop: () => { n++; } }), call({ action: "StopTransaction", payload: { transactionId: 1, meterStop: 1, timestamp: "2026-10-30T10:00:00Z" } }));
    expect(n).toBe(0);
    void down;
  });
});

describe("live configuration", () => {
  it("bounds the heartbeat interval variable and defaults safely", () => {
    expect(heartbeatSeconds({})).toBe(3600);
    expect(heartbeatSeconds({ OCPP_HEARTBEAT_INTERVAL_SECONDS: "300" })).toBe(300);
    expect(heartbeatSeconds({ OCPP_HEARTBEAT_INTERVAL_SECONDS: "5" })).toBe(3600);
    expect(heartbeatSeconds({ OCPP_HEARTBEAT_INTERVAL_SECONDS: "abc" })).toBe(3600);
  });
});
