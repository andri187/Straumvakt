import { beforeAll, describe, expect, it } from "vitest";
import { hashInstallationPassword } from "@/lib/installations/password";
import { decideAdmission, wireStatus, type AdmissionInstallation, type AdmissionLookup, type AdmissionStore } from "./admission";
import { decideAuthorization, type AuthorizationFacts } from "./authorization";
import { parseBasic, parseRoute } from "./route";

const AT = new Date("2026-10-29T12:00:00Z");
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const INST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INST_A2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2"; // a second installation of the SAME CPO
const INST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OLD_KEY = "abcdefghijk1"; // an installation key as it appeared in the retired URL form

function route(host: string, path: string) {
  const r = parseRoute(host, path);
  if (!r.ok) throw new Error(r.problem);
  return r.route;
}

type Identity = { orgId: string; chargePointId: string; deviceId: string; identityString: string; current: boolean; placements: { id: string; orgId: string; installationId: string; current: boolean }[] };

type World = {
  orgs: Record<string, { id: string; active: boolean }>; // by routing id
  installations: Record<string, AdmissionInstallation>; // by installation id
  identities: Identity[];
};

type Calls = { lookups: number; lookupArgs: unknown[]; discoveries: unknown[] };

/** Mirrors the Drizzle lookup: scoped to the CPO named by the host, matched by charge point id ignoring case, installation attached from the placement. */
function store(world: World, calls: Calls = { lookups: 0, lookupArgs: [], discoveries: [] }, fail = false): AdmissionStore & { calls: Calls } {
  return {
    calls,
    async lookup(r) {
      calls.lookups++;
      calls.lookupArgs.push(r);
      if (fail) throw new Error("db down");
      const org = world.orgs[r.routingId] ?? null;
      if (!org) return { org: null, identities: [] };
      return {
        org,
        identities: world.identities
          .filter((i) => i.orgId === org.id && i.chargePointId.toLowerCase() === r.chargePointId.toLowerCase())
          .map(({ orgId: _o, ...rest }): AdmissionLookup["identities"][number] => ({
            ...rest,
            placements: rest.placements.map((p) => ({ ...p, installation: world.installations[p.installationId] ?? null })),
          })),
      };
    },
    async recordDiscovery(input) {
      calls.discoveries.push(input);
    },
  };
}

let verifier: string;
beforeAll(async () => {
  verifier = await hashInstallationPassword("correct horse battery staple");
});

function baseWorld(mode: "unset" | "none" | "password" = "none"): World {
  return {
    orgs: { cpoa: { id: ORG_A, active: true }, cpob: { id: ORG_B, active: true } },
    installations: {
      [INST_A]: { id: INST_A, orgId: ORG_A, archived: false, passwordMode: mode, passwordVerifier: mode === "password" ? verifier : null, credentialEpoch: "e1" },
      [INST_A2]: { id: INST_A2, orgId: ORG_A, archived: false, passwordMode: "none", passwordVerifier: null, credentialEpoch: "e2" },
      [INST_B]: { id: INST_B, orgId: ORG_B, archived: false, passwordMode: "none", passwordVerifier: null, credentialEpoch: "e1" },
    },
    identities: [
      { orgId: ORG_A, chargePointId: "CP-1", deviceId: DEV, identityString: `${ORG_A}/CP-1`, current: true, placements: [{ id: "p1", orgId: ORG_A, installationId: INST_A, current: true }] },
    ],
  };
}

const HOST_A = "cpoa.straumvakt.org";

describe("route parsing", () => {
  it("normalises the host but never the charge-point id, and takes only that id from the path", () => {
    expect(route("CpoA.Straumvakt.ORG:443", "/CP-1")).toEqual({ routingId: "cpoa", chargePointId: "CP-1" });
    expect(route(HOST_A, "/cp-1").chargePointId).toBe("cp-1");
    expect(route(HOST_A, "/CP%2D1").chargePointId).toBe("CP-1");
  });
  it("rejects foreign hosts, nested labels, a missing or empty path, and any extra segment", () => {
    expect(parseRoute("cpoa.example.com", "/CP-1")).toMatchObject({ ok: false, problem: "bad_host" });
    expect(parseRoute("a.b.straumvakt.org", "/CP-1")).toMatchObject({ ok: false, problem: "bad_host" });
    expect(parseRoute("straumvakt.org", "/CP-1")).toMatchObject({ ok: false, problem: "bad_host" });
    expect(parseRoute(HOST_A, "/")).toMatchObject({ ok: false, problem: "bad_path" });
    expect(parseRoute(HOST_A, "")).toMatchObject({ ok: false, problem: "bad_path" });
    expect(parseRoute(HOST_A, "/CP-1/")).toMatchObject({ ok: false, problem: "bad_path" });
    expect(parseRoute(HOST_A, "/ocpp/1.6/CP-1")).toMatchObject({ ok: false, problem: "bad_path" });
    expect(parseRoute(HOST_A, "/CP-1/CP-1")).toMatchObject({ ok: false, problem: "bad_path" });
  });
  it("refuses the retired /{installation-key}/{charge-point-id} form: it is never read as a charge point id", () => {
    expect(parseRoute(HOST_A, `/${OLD_KEY}/CP-1`)).toMatchObject({ ok: false, problem: "bad_path" });
    // ...and a bare key is just a charge point id like any other, resolved against the CPO's own registrations.
    expect(route(HOST_A, `/${OLD_KEY}`)).toEqual({ routingId: "cpoa", chargePointId: OLD_KEY });
  });
  it("refuses encoded separators, traversal, malformed escapes and ids the save path would not accept", () => {
    expect(parseRoute(HOST_A, "/..%2Fx")).toMatchObject({ ok: false, problem: "bad_charge_point_id" });
    expect(parseRoute(HOST_A, "/a%2Fb")).toMatchObject({ ok: false, problem: "bad_charge_point_id" });
    expect(parseRoute(HOST_A, "/%E0%A4%A")).toMatchObject({ ok: false, problem: "bad_path" });
    expect(parseRoute(HOST_A, "/-lead")).toMatchObject({ ok: false, problem: "bad_charge_point_id" });
    expect(parseRoute(HOST_A, `/${"a".repeat(49)}`)).toMatchObject({ ok: false, problem: "bad_charge_point_id" });
  });
  it("parses Basic and refuses malformed or empty-password headers", () => {
    const h = "Basic " + btoa("CP-1:s3cret:with:colons");
    expect(parseBasic(h)).toEqual({ username: "CP-1", password: "s3cret:with:colons" });
    expect(parseBasic(null)).toBeNull();
    expect(parseBasic("Bearer x")).toBeNull();
    expect(parseBasic("Basic " + btoa("CP-1:"))).toBeNull();
    expect(parseBasic("Basic " + btoa(":pw"))).toBeNull();
    expect(parseBasic("Basic !!!")).toBeNull();
  });
});

describe("admission", () => {
  it("admits a registered, placed device in the deliberate no-password mode and says so", async () => {
    const d = await decideAdmission(store(baseWorld("none")), route(HOST_A, "/CP-1"), null, AT);
    expect(d).toMatchObject({ kind: "admit", context: { orgId: ORG_A, installationId: INST_A, deviceId: DEV, placementId: "p1", chargePointId: "CP-1", identityString: `${ORG_A}/CP-1`, credentialMode: "none" } });
  });

  it("derives the installation from the registered placement: the lookup is given the CPO and the id, nothing else to choose by", async () => {
    const s = store(baseWorld("none"));
    const d = await decideAdmission(s, route(HOST_A, "/CP-1"), null, AT);
    expect(s.calls.lookupArgs).toEqual([{ routingId: "cpoa", chargePointId: "CP-1" }]);
    expect(d).toMatchObject({ kind: "admit", context: { installationId: INST_A } });
    expect(JSON.stringify(d)).not.toContain(OLD_KEY);
  });

  it("the same charge point id in two CPOs resolves each to its own tenant and never crosses", async () => {
    const w = baseWorld("none");
    w.identities.push({ orgId: ORG_B, chargePointId: "CP-1", deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", identityString: `${ORG_B}/CP-1`, current: true, placements: [{ id: "p2", orgId: ORG_B, installationId: INST_B, current: true }] });
    const a = await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT);
    const b = await decideAdmission(store(w), route("cpob.straumvakt.org", "/CP-1"), null, AT);
    expect(a).toMatchObject({ kind: "admit", context: { orgId: ORG_A, placementId: "p1", deviceId: DEV } });
    expect(b).toMatchObject({ kind: "admit", context: { orgId: ORG_B, placementId: "p2", deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } });
  });

  it("a charge point id registered only in another CPO is unknown here: unregistered, never admitted, never assigned", async () => {
    const w = baseWorld("none");
    const s = store(w);
    const d = await decideAdmission(s, route("cpob.straumvakt.org", "/CP-1"), null, AT);
    expect(d).toEqual({ kind: "deny", reason: "unregistered" });
    expect(s.calls.discoveries).toEqual([{ orgId: ORG_B, chargePointId: "CP-1", at: AT }]);
  });

  it("refuses an unknown or inactive CPO without writing anything", async () => {
    const w = baseWorld("none");
    const s = store(w);
    expect(await decideAdmission(s, route("nobody.straumvakt.org", "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "unknown_route" });
    w.orgs.cpoa!.active = false;
    expect(await decideAdmission(s, route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "unknown_route" });
    expect(s.calls.discoveries).toEqual([]);
  });

  it("refuses when the placed installation is archived, missing, or belongs to another CPO", async () => {
    const w = baseWorld("none");
    w.installations[INST_A]!.archived = true;
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "installation_unavailable" });
    w.installations[INST_A]!.archived = false;
    w.installations[INST_A]!.orgId = ORG_B;
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "installation_unavailable" });
    w.installations[INST_A]!.orgId = ORG_A;
    delete w.installations[INST_A];
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "installation_unavailable" });
  });

  it("does not match identities case-insensitively: a case-only difference is its own refusal", async () => {
    const d = await decideAdmission(store(baseWorld("none")), route(HOST_A, "/cp-1"), null, AT);
    expect(d).toEqual({ kind: "deny", reason: "identity_case_mismatch" });
  });

  it("records an unregistered charger for discovery without admitting it or granting a placement", async () => {
    const s = store(baseWorld("none"));
    const d = await decideAdmission(s, route(HOST_A, "/NEW-ONE"), null, AT);
    expect(d).toEqual({ kind: "deny", reason: "unregistered" });
    // Keyed by CPO and id only: an unknown connection is never attributed to an installation.
    expect(s.calls.discoveries).toEqual([{ orgId: ORG_A, chargePointId: "NEW-ONE", at: AT }]);
  });

  it("a failing discovery write never changes the refusal", async () => {
    const s = store(baseWorld("none"));
    s.recordDiscovery = async () => {
      throw new Error("write failed");
    };
    expect(await decideAdmission(s, route(HOST_A, "/NEW-ONE"), null, AT)).toEqual({ kind: "deny", reason: "unregistered" });
  });

  it("refuses an inactive placement, a placement in another CPO, and ambiguous assignment", async () => {
    const w = baseWorld("none");
    w.identities[0]!.placements = [{ id: "p1", orgId: ORG_A, installationId: INST_A, current: false }];
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "no_active_placement" });
    w.identities[0]!.placements = [{ id: "p9", orgId: ORG_B, installationId: INST_B, current: true }];
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "placement_elsewhere" });
    w.identities[0]!.placements = [
      { id: "p1", orgId: ORG_A, installationId: INST_A, current: true },
      { id: "p2", orgId: ORG_A, installationId: INST_A, current: true },
    ];
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "ambiguous_placement" });
    // a second live placement elsewhere is also ambiguous: the device cannot be in two places, even in two installations of one CPO
    w.identities[0]!.placements = [
      { id: "p1", orgId: ORG_A, installationId: INST_A, current: true },
      { id: "p3", orgId: ORG_A, installationId: INST_A2, current: true },
    ];
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "ambiguous_placement" });
  });

  it("a charger moved to another installation of the SAME CPO keeps its URL and is admitted under the new installation's own credential policy", async () => {
    const w = baseWorld("password");
    const before = await decideAdmission(store(w), route(HOST_A, "/CP-1"), { username: "CP-1", password: "correct horse battery staple" }, AT);
    expect(before).toMatchObject({ kind: "admit", context: { installationId: INST_A, credentialMode: "password" } });
    // The old placement closes and a new one opens at the CPO's other installation (INST_A2 has no password by choice).
    w.identities[0]!.placements = [
      { id: "p1", orgId: ORG_A, installationId: INST_A, current: false },
      { id: "p7", orgId: ORG_A, installationId: INST_A2, current: true },
    ];
    const after = await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT);
    expect(after).toMatchObject({ kind: "admit", context: { installationId: INST_A2, placementId: "p7", credentialMode: "none", credentialEpoch: "e2" } });
  });

  it("records a REMOVED or RETIRED device that keeps connecting (expired identity, closed placement) for the operator, throttled, and still refuses it", async () => {
    const w = baseWorld("none");
    w.identities[0]!.current = false;
    const s1 = store(w);
    expect(await decideAdmission(s1, route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "identity_not_current" });
    expect(s1.calls.discoveries).toEqual([expect.objectContaining({ orgId: ORG_A, chargePointId: "CP-1", reason: "identity_not_current" })]);
    const w2 = baseWorld("none");
    w2.identities[0]!.placements = [{ id: "p1", orgId: ORG_A, installationId: INST_A, current: false }];
    const s2 = store(w2);
    await decideAdmission(s2, route(HOST_A, "/CP-1"), null, AT);
    expect(s2.calls.discoveries).toEqual([expect.objectContaining({ reason: "no_active_placement" })]);
  });
  it("a failing discovery write for a closed identity never changes the refusal", async () => {
    const w = baseWorld("none");
    w.identities[0]!.current = false;
    const s = store(w);
    s.recordDiscovery = async () => { throw new Error("write failed"); };
    expect(await decideAdmission(s, route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "identity_not_current" });
  });
  it("refuses an expired identity period and two current identities for one id, but history does not block a successor", async () => {
    const w = baseWorld("none");
    w.identities[0]!.current = false;
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "identity_not_current" });
    // A different device later took over the same id in the same CPO: the retired row is history, the current one is admitted.
    const successor = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    w.identities.push({ orgId: ORG_A, chargePointId: "CP-1", deviceId: successor, identityString: `${ORG_A}/CP-1`, current: true, placements: [{ id: "p5", orgId: ORG_A, installationId: INST_A2, current: true }] });
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toMatchObject({ kind: "admit", context: { deviceId: successor, installationId: INST_A2 } });
    // Two CURRENT rows for one id in one CPO cannot be told apart: refused (the database also forbids it).
    w.identities[0]!.current = true;
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toEqual({ kind: "deny", reason: "ambiguous_identity" });
  });
  it("an identity written before the CPO-only URL still resolves through its CPO columns, and keeps its stored string for history", async () => {
    const w = baseWorld("none");
    w.identities[0]!.identityString = `${OLD_KEY}/CP-1`;
    expect(await decideAdmission(store(w), route(HOST_A, "/CP-1"), null, AT)).toMatchObject({ kind: "admit", context: { identityString: `${OLD_KEY}/CP-1`, chargePointId: "CP-1" } });
  });

  describe("credential modes", () => {
    it("unset is not permission", async () => {
      const d = await decideAdmission(store(baseWorld("unset")), route(HOST_A, "/CP-1"), null, AT);
      expect(d).toEqual({ kind: "deny", reason: "credentials_not_configured" });
    });
    it("password mode requires Basic with the charge-point id as username", async () => {
      const w = baseWorld("password");
      const r = route(HOST_A, "/CP-1");
      expect(await decideAdmission(store(w), r, null, AT)).toEqual({ kind: "deny", reason: "credentials_required" });
      expect(await decideAdmission(store(w), r, { username: "CP-1", password: "wrong wrong wrong" }, AT)).toEqual({ kind: "deny", reason: "bad_credentials" });
      // a composite or CPO-qualified name is not a valid username
      expect(await decideAdmission(store(w), r, { username: `${ORG_A}/CP-1`, password: "correct horse battery staple" }, AT)).toEqual({ kind: "deny", reason: "username_mismatch" });
      expect(await decideAdmission(store(w), r, { username: "CP-2", password: "correct horse battery staple" }, AT)).toEqual({ kind: "deny", reason: "username_mismatch" });
      expect(await decideAdmission(store(w), r, { username: "CP-1", password: "correct horse battery staple" }, AT)).toMatchObject({ kind: "admit", context: { credentialMode: "password" } });
    });
    it("password mode with a missing verifier fails closed", async () => {
      const w = baseWorld("password");
      w.installations[INST_A]!.passwordVerifier = null;
      const d = await decideAdmission(store(w), route(HOST_A, "/CP-1"), { username: "CP-1", password: "correct horse battery staple" }, AT);
      expect(d).toEqual({ kind: "deny", reason: "credentials_not_configured" });
    });
    it("none mode admits without credentials, but refuses a header naming a different charger", async () => {
      const w = baseWorld("none");
      const r = route(HOST_A, "/CP-1");
      expect(await decideAdmission(store(w), r, null, AT)).toMatchObject({ kind: "admit" });
      expect(await decideAdmission(store(w), r, { username: "CP-1", password: "anything" }, AT)).toMatchObject({ kind: "admit" });
      expect(await decideAdmission(store(w), r, { username: "CP-9", password: "anything" }, AT)).toEqual({ kind: "deny", reason: "username_mismatch" });
    });
    it("does not pay for a password hash before cheap checks pass", async () => {
      const w = baseWorld("password");
      w.identities[0]!.placements = [];
      // A wrong password with no placement must report the placement: had the hash been checked first it would say bad_credentials.
      const d = await decideAdmission(store(w), route(HOST_A, "/CP-1"), { username: "CP-1", password: "definitely the wrong one" }, AT);
      expect(d).toEqual({ kind: "deny", reason: "no_active_placement" });
    });
  });

  it("reports a database failure as unavailable (503), distinct from every refusal (401)", async () => {
    const d = await decideAdmission(store(baseWorld("none"), undefined, true), route(HOST_A, "/CP-1"), null, AT);
    expect(d).toEqual({ kind: "unavailable" });
    expect(wireStatus(d as never)).toBe(503);
    expect(wireStatus({ kind: "deny", reason: "unknown_route" })).toBe(401);
  });

  it("admission is one lookup; a refusal never leaks which check failed on the wire status", async () => {
    const s = store(baseWorld("none"));
    await decideAdmission(s, route(HOST_A, "/CP-1"), null, AT);
    expect(s.calls.lookups).toBe(1);
  });
});

describe("authorization", () => {
  const facts = (over: Partial<Omit<AuthorizationFacts, "token">> & { token?: Partial<NonNullable<AuthorizationFacts["token"]>> | null } = {}): AuthorizationFacts => ({
    token: over.token === null ? null : { id: "tok", userId: "usr", status: "active", expiresAt: null, scopeInstallationId: null, ...over.token },
    userActive: over.userActive ?? true,
    hasInstallationAccess: over.hasInstallationAccess ?? true,
  });
  const run = (f: AuthorizationFacts) => decideAuthorization({ facts: async () => f }, { idTag: "TAG", installationId: INST_A, at: AT });

  it("accepts an enrolled, active, in-scope driver with current access", async () => {
    expect(await run(facts())).toEqual({ kind: "decided", status: "Accepted", reason: "ok", userId: "usr", idTokenId: "tok" });
  });
  it("refuses a vendor fixed test tag that is not an enrolled token (no bypass)", async () => {
    expect(await run(facts({ token: null }))).toEqual({ kind: "decided", status: "Invalid", reason: "unknown_id_tag" });
  });
  it("maps token status and expiry", async () => {
    expect(await run(facts({ token: { status: "revoked" } }))).toMatchObject({ status: "Blocked", reason: "revoked" });
    expect(await run(facts({ token: { status: "suspended" } }))).toMatchObject({ status: "Blocked", reason: "suspended" });
    expect(await run(facts({ token: { status: "expired" } }))).toMatchObject({ status: "Expired", reason: "expired_status" });
    expect(await run(facts({ token: { expiresAt: new Date(AT.getTime() - 1) } }))).toMatchObject({ status: "Expired", reason: "expiry_passed" });
    expect(await run(facts({ token: { expiresAt: new Date(AT.getTime()) } }))).toMatchObject({ status: "Expired", reason: "expiry_passed" });
    expect(await run(facts({ token: { status: "mystery" } }))).toMatchObject({ status: "Invalid" });
  });
  it("refuses a token scoped to another installation without revealing it exists, and enforces cross-installation access", async () => {
    const r = await run(facts({ token: { scopeInstallationId: INST_B } }));
    expect(r).toEqual({ kind: "decided", status: "Invalid", reason: "scope_mismatch" });
    expect(await run(facts({ hasInstallationAccess: false }))).toMatchObject({ status: "Blocked", reason: "no_access" });
    expect(await run(facts({ userActive: false }))).toMatchObject({ status: "Blocked", reason: "user_inactive" });
  });
  it("reports dependency failure as unavailable, not as a decision about the token", async () => {
    const d = await decideAuthorization({ facts: async () => { throw new Error("db down"); } }, { idTag: "TAG", installationId: INST_A, at: AT });
    expect(d).toEqual({ kind: "unavailable" });
  });
});
