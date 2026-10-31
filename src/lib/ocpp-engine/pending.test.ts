// Pending onboarding, engine side: policy, the admission decision, registration classification and the capture RPC.
// LOCAL FIXTURES ONLY: in-memory stores, no database, no gateway, no charger.

import { describe, expect, it } from "vitest";
import { decideAdmission, type AdmissionLookup, type AdmissionStore } from "./admission";
import { buildBootCapture, payloadHash, pendingBootResponse, pendingRetrySeconds, PENDING_RETRY_SECONDS, MAX_PENDING_FRAME_BYTES } from "./pending";
import { classifyRegistration, rpcPending, type PendingStore, type RegistrationState } from "./pending-service";
import { parseRoute } from "./route";
import { rpcAdmit, rpcPendingOp, type EngineRpcDeps } from "./rpc";

const AT = new Date("2026-10-31T12:00:00Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOT = { chargePointVendor: "Zaptec", chargePointModel: "Go", chargePointSerialNumber: "ZPR074002", iccid: "8935800000000000000", imsi: "274020000000000", vendorExtra: { a: [1, 2] } };

const route = (host: string, path: string) => {
  const r = parseRoute(host, path);
  if (!r.ok) throw new Error(r.problem);
  return r.route;
};
const installation = { id: INST, orgId: ORG, archived: false, passwordMode: "none" as const, passwordVerifier: null, credentialEpoch: "e1" };
const registered = (over: Partial<AdmissionLookup["identities"][number]> = {}): AdmissionLookup["identities"][number] => ({
  deviceId: "dev", chargePointId: "CP-1", identityString: `${ORG}/CP-1`, current: true,
  placements: [{ id: "p1", orgId: ORG, installationId: INST, current: true, installation }], ...over,
});
const lookupOf = (identities: AdmissionLookup["identities"], org: AdmissionLookup["org"] = { id: ORG, active: true }): AdmissionLookup => ({ org, identities });
function admissionStore(found: AdmissionLookup) {
  const discoveries: unknown[] = [];
  const s: AdmissionStore = { lookup: async () => found, recordDiscovery: async (i) => void discoveries.push(i) };
  return { s, discoveries };
}

describe("pending policy", () => {
  it("Pending carries the server time and a nonzero documented retry interval (OCPP 1.6 ed.2 s4.2)", () => {
    const r = pendingBootResponse(AT);
    expect(r).toEqual({ status: "Pending", currentTime: AT.toISOString(), interval: PENDING_RETRY_SECONDS });
    expect(r.interval).toBeGreaterThan(0);
    expect(PENDING_RETRY_SECONDS).toBe(1800);
  });
  it("the interval is configurable in one place, bounded, and falls back for nonsense (never zero)", () => {
    expect(pendingRetrySeconds("900")).toBe(900);
    for (const bad of [undefined, "", "0", "-5", "59", "86401", "abc", "1.5"]) expect(pendingRetrySeconds(bad)).toBe(1800);
  });
  it("the capture keeps the payload exactly as received, including optional ICCID/IMSI and vendor extensions, and records the validation outcome", async () => {
    const c = await buildBootCapture({ messageId: "m1", receivedAt: AT.toISOString(), frameBytes: 321, payload: BOOT });
    expect(c.payload).toEqual(BOOT);
    expect(c.validation).toMatchObject({ ok: false, code: "FormationViolation" }); // the extension is refused by the schema, but kept
    expect(c.frameBytes).toBe(321);
    const ok = await buildBootCapture({ messageId: "m2", receivedAt: AT.toISOString(), frameBytes: 100, payload: { chargePointVendor: "V", chargePointModel: "M", iccid: "1", imsi: "2" } });
    expect(ok.validation).toEqual({ ok: true });
    expect((ok.payload as { iccid: string }).iccid).toBe("1");
  });
  it("the dedupe hash ignores key order and changes with any value", async () => {
    expect(await payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(await payloadHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(await payloadHash({ a: 1 })).not.toBe(await payloadHash({ a: 2 }));
  });
});

describe("admission: pending is an explicit, narrow outcome", () => {
  it("an unknown id of an active CPO is pending ONLY when asked; otherwise the plain refusal is unchanged", async () => {
    const { s, discoveries } = admissionStore(lookupOf([]));
    expect(await decideAdmission(s, route("cpoa.straumvakt.org", "/NEW-1"), null, AT)).toEqual({ kind: "deny", reason: "unregistered" });
    expect(await decideAdmission(s, route("cpoa.straumvakt.org", "/NEW-1"), null, AT, { acceptPending: true })).toEqual({ kind: "pending", orgId: ORG, chargePointId: "NEW-1" });
    expect(discoveries).toHaveLength(2); // the knock is recorded either way, as before
  });
  it.each([
    ["a retired identity (period ended)", [registered({ current: false })], "identity_not_current"],
    ["a case-only difference", [registered({ chargePointId: "cp-1" })], "identity_case_mismatch"],
    ["an ambiguous identity", [registered(), registered({ deviceId: "dev2", identityString: `${ORG}/CP-1b` })], "ambiguous_identity"],
    ["a known identity with no current placement", [registered({ placements: [] })], "no_active_placement"],
  ] as const)("%s is NEVER pending, even when asked", async (_name, identities, reason) => {
    const { s } = admissionStore(lookupOf([...identities]));
    const d = await decideAdmission(s, route("cpoa.straumvakt.org", "/CP-1"), null, AT, { acceptPending: true });
    expect(d).toEqual({ kind: "deny", reason });
  });
  it("an inactive or unknown CPO is never pending", async () => {
    for (const org of [null, { id: ORG, active: false }]) {
      const { s, discoveries } = admissionStore(lookupOf([], org));
      expect(await decideAdmission(s, route("cpoa.straumvakt.org", "/NEW-1"), null, AT, { acceptPending: true })).toEqual({ kind: "deny", reason: "unknown_route" });
      expect(discoveries).toHaveLength(0);
    }
  });
  it("a registered charger with bad or missing credentials is refused, not pending", async () => {
    const { s } = admissionStore(lookupOf([registered({ placements: [{ id: "p1", orgId: ORG, installationId: INST, current: true, installation: { ...installation, passwordMode: "password", passwordVerifier: "v" } }] })]));
    expect(await decideAdmission(s, route("cpoa.straumvakt.org", "/CP-1"), null, AT, { acceptPending: true })).toEqual({ kind: "deny", reason: "credentials_required" });
  });
  it("rpcAdmit answers pending only when asked, and hands back the routing id the gateway will use", async () => {
    const { s } = admissionStore(lookupOf([]));
    const deps: EngineRpcDeps = { now: () => AT, heartbeatIntervalSeconds: 3600, withAdmission: async (fn) => fn(s), withEngine: async () => null };
    expect(await rpcAdmit(deps, { host: "cpoa.straumvakt.org", pathname: "/NEW-1" })).toEqual({ kind: "deny" });
    expect(await rpcAdmit(deps, { host: "cpoa.straumvakt.org", pathname: "/NEW-1", acceptPending: "yes" })).toEqual({ kind: "deny" });
    expect(await rpcAdmit(deps, { host: "cpoa.straumvakt.org", pathname: "/NEW-1", acceptPending: true })).toEqual({ kind: "pending", orgId: ORG, routingId: "cpoa", chargePointId: "NEW-1" });
  });
});

describe("registration classification (no credentials involved)", () => {
  const cls = (l: AdmissionLookup, id = "CP-1") => classifyRegistration(l, id);
  it("unregistered / registered / known / inactive", () => {
    expect(cls(lookupOf([]))).toBe("unregistered");
    expect(cls(lookupOf([registered()]))).toBe("registered");
    expect(cls(lookupOf([registered({ current: false })]))).toBe("known");
    expect(cls(lookupOf([registered({ placements: [] })]))).toBe("known");
    expect(cls(lookupOf([registered({ chargePointId: "cp-1" })]))).toBe("known");
    expect(cls(lookupOf([], null))).toBe("inactive");
    expect(cls(lookupOf([], { id: ORG, active: false }))).toBe("inactive");
  });
  it("a placement in another CPO, an archived or missing installation, or two placements is known, not registered", () => {
    const p = registered().placements[0]!;
    expect(cls(lookupOf([registered({ placements: [{ ...p, orgId: OTHER_ORG }] })]))).toBe("known");
    expect(cls(lookupOf([registered({ placements: [{ ...p, installation: { ...installation, archived: true } }] })]))).toBe("known");
    expect(cls(lookupOf([registered({ placements: [{ ...p, installation: null }] })]))).toBe("known");
    expect(cls(lookupOf([registered({ placements: [p, { ...p, id: "p2" }] })]))).toBe("known");
  });
  it("a registered charger in password mode is still 'registered': credentials are checked at the reconnect, never here", () => {
    const p = registered().placements[0]!;
    expect(cls(lookupOf([registered({ placements: [{ ...p, installation: { ...installation, passwordMode: "password", passwordVerifier: "v" } }] })]))).toBe("registered");
  });
});

function memoryPending(state: RegistrationState = "unregistered", orgId: string | null = ORG) {
  const writes: { kind: string; input: unknown }[] = [];
  let storeResult: "stored" | "unchanged" | "full" = "stored";
  let fail = false;
  let hasCapture = true;
  const s: PendingStore = {
    registration: async (i) => { if (fail) throw new Error("db"); writes.push({ kind: "registration", input: i }); return { state, orgId }; },
    storeBoot: async (i) => { writes.push({ kind: "storeBoot", input: i }); return storeResult; },
    touch: async (i) => void writes.push({ kind: "touch", input: i }),
    hasCapture: async () => hasCapture,
  };
  return { s, writes, set: (r: typeof storeResult) => (storeResult = r), failDb: () => (fail = true), setHasCapture: (v: boolean) => (hasCapture = v) };
}
const run = (m: ReturnType<typeof memoryPending>, input: unknown) => rpcPending({ now: () => AT, withPending: async (fn) => fn(m.s) }, input);
const bootInput = (over: Record<string, unknown> = {}) => ({ op: "boot", routingId: "cpoa", chargePointId: "NEW-1", messageId: "m1", receivedAt: AT.toISOString(), frameBytes: 200, payload: BOOT, ...over });

describe("pending RPC", () => {
  it("stores the complete payload for an unregistered charger, deriving the CPO from the routing id (a supplied orgId is ignored)", async () => {
    const m = memoryPending();
    expect(await run(m, bootInput({ orgId: OTHER_ORG }))).toEqual({ kind: "captured", result: "stored" });
    const w = m.writes.find((x) => x.kind === "storeBoot")!.input as { orgId: string; chargePointId: string; capture: { payload: unknown; messageId: string } };
    expect(w.orgId).toBe(ORG);
    expect(w.chargePointId).toBe("NEW-1");
    expect(w.capture.payload).toEqual(BOOT);
    expect(w.capture.messageId).toBe("m1");
  });
  it("passes through unchanged and full results", async () => {
    const m = memoryPending();
    m.set("unchanged");
    expect(await run(m, bootInput())).toEqual({ kind: "captured", result: "unchanged" });
    m.set("full");
    expect(await run(m, bootInput())).toEqual({ kind: "captured", result: "full" });
  });
  it.each(["registered", "known", "inactive"] as const)("a %s charger is never stored as a candidate", async (state) => {
    const m = memoryPending(state, state === "inactive" ? null : ORG);
    expect(await run(m, bootInput())).toEqual({ kind: "state", state });
    expect(m.writes.some((w) => w.kind === "storeBoot")).toBe(false);
  });
  it("check reads the registration and writes nothing; closed touches only an unregistered charger", async () => {
    const m = memoryPending("registered");
    expect(await run(m, { op: "check", routingId: "cpoa", chargePointId: "NEW-1" })).toEqual({ kind: "state", state: "registered" });
    expect(await run(m, { op: "closed", routingId: "cpoa", chargePointId: "NEW-1" })).toEqual({ kind: "ok" });
    expect(m.writes.map((w) => w.kind)).toEqual(["registration", "registration"]);
    const u = memoryPending("unregistered");
    await run(u, { op: "closed", routingId: "cpoa", chargePointId: "NEW-1" });
    expect(u.writes.map((w) => w.kind)).toEqual(["registration", "touch"]);
  });
  it("validates every input: bad ids, oversize, missing fields and unknown operations are rejected before any database access", async () => {
    const m = memoryPending();
    for (const bad of [null, {}, bootInput({ routingId: "Bad Host" }), bootInput({ chargePointId: "../x" }), bootInput({ op: "delete" }), bootInput({ messageId: "" }), bootInput({ messageId: "x".repeat(37) }), bootInput({ receivedAt: "nope" }), bootInput({ frameBytes: 0 })]) {
      expect((await run(m, bad)).kind, JSON.stringify(bad)).toBe("rejected");
    }
    const big = await run(m, bootInput({ payload: { chargePointVendor: "x".repeat(MAX_PENDING_FRAME_BYTES + 1) } }));
    expect(big).toEqual({ kind: "rejected", status: 413 });
    expect(await run(m, bootInput({ frameBytes: MAX_PENDING_FRAME_BYTES + 1 }))).toEqual({ kind: "rejected", status: 413 });
    expect(m.writes).toHaveLength(0);
  });
  it("a database failure is 'unavailable', never a guessed answer; an unconfigured database too", async () => {
    const m = memoryPending();
    m.failDb();
    expect(await run(m, bootInput())).toEqual({ kind: "unavailable" });
    expect(await rpcPending({ now: () => AT, withPending: async () => null }, bootInput())).toEqual({ kind: "unavailable" });
    expect(await rpcPendingOp({ now: () => AT } as unknown as EngineRpcDeps, bootInput())).toEqual({ kind: "unavailable" });
  });
});

describe("review fixes: capture presence report and credential refusals", () => {
  it("check reports whether the capture is still stored, only for an unregistered charger", async () => {
    const m = memoryPending("unregistered");
    expect(await run(m, { op: "check", routingId: "cpoa", chargePointId: "NEW-1" })).toEqual({ kind: "state", state: "unregistered", hasCapture: true });
    m.setHasCapture(false);
    expect(await run(m, { op: "check", routingId: "cpoa", chargePointId: "NEW-1" })).toEqual({ kind: "state", state: "unregistered", hasCapture: false });
    const registered = memoryPending("registered");
    expect(await run(registered, { op: "check", routingId: "cpoa", chargePointId: "NEW-1" })).toEqual({ kind: "state", state: "registered" });
  });
  it("a REGISTERED charger refused for credentials is recorded with the reason code (no value), so the operator can see why", async () => {
    const withMode = (passwordMode: "unset" | "password", verifier: string | null) =>
      lookupOf([registered({ placements: [{ id: "p1", orgId: ORG, installationId: INST, current: true, installation: { ...installation, passwordMode, passwordVerifier: verifier } }] })]);
    const cases: [string, AdmissionLookup, { username: string; password: string } | null, string][] = [
      ["credentials_not_configured", withMode("unset", null), null, "credentials_not_configured"],
      ["credentials_required", withMode("password", "v"), null, "credentials_required"],
      ["username_mismatch", withMode("password", "v"), { username: "OTHER", password: "x" }, "username_mismatch"],
    ];
    for (const [, found, basic, reason] of cases) {
      const { s, discoveries } = admissionStore(found);
      expect(await decideAdmission(s, route("cpoa.straumvakt.org", "/CP-1"), basic, AT)).toEqual({ kind: "deny", reason });
      expect(discoveries).toEqual([{ orgId: ORG, chargePointId: "CP-1", at: AT, reason }]);
      expect(JSON.stringify(discoveries)).not.toMatch(/password|verifier|Basic/i);
    }
  });
  it("a successful admission records nothing; a failing refusal write never changes the refusal", async () => {
    const ok = admissionStore(lookupOf([registered()]));
    expect((await decideAdmission(ok.s, route("cpoa.straumvakt.org", "/CP-1"), null, AT)).kind).toBe("admit");
    expect(ok.discoveries).toEqual([]);
    const bad = admissionStore(lookupOf([registered({ placements: [{ id: "p1", orgId: ORG, installationId: INST, current: true, installation: { ...installation, passwordMode: "password", passwordVerifier: "v" } }] })]));
    bad.s.recordDiscovery = async () => { throw new Error("write failed"); };
    expect(await decideAdmission(bad.s, route("cpoa.straumvakt.org", "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "credentials_required" });
  });
});
