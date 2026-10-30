import { describe, expect, it } from "vitest";
import { sharedLoginActor } from "./actor";
import { MemoryStore } from "./__tests__/memory-store";
import {
  SaveInstallationInput,
  connectionAddress,
  effectiveAllowanceAmps,
  isReservedRoutingLabel,
  newInstallationKey,
  responsibleStatus,
  routingLabelFromName,
} from "./model";
import { generateInstallationPassword, hashInstallationPassword, verifyInstallationPassword } from "./password";
import { planSave } from "./plan";
import { saveInstallation, type ServiceDeps } from "./service";
import { SaveError } from "./store";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const actor = sharedLoginActor("Straumvakt");

let counter = 0;
const deps = (): ServiceDeps => ({
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  newKey: () => "abcdefghjkmn",
  hashPassword: async (p) => `verifier(${p.length})`,
  generatePassword: () => "GENERATED-ONCE-0123456789",
  now: () => new Date("2026-10-29T12:00:00Z"),
});

type Over = Record<string, unknown>;
const uuid = () => crypto.randomUUID();
function input(over: Over = {}) {
  return SaveInstallationInput.parse({
    orgId: ORG,
    siteId: SITE,
    idempotencyKey: uuid(),
    installation: { displayName: "Harbour car park" },
    electrician: {},
    circuits: [],
    chargers: [],
    ...over,
  });
}

function seeded() {
  const store = new MemoryStore();
  store.seedOrg(ORG, "Nordic Charge ehf.", SITE);
  store.seedOrg(OTHER_ORG, "Other CPO", "44444444-4444-4444-8444-444444444444");
  return store;
}

const circuit = (id: string, parentId: string | null, extra: Over = {}) => ({ id, parentId, displayName: id, ...extra });
const charger = (id: string, circuitId: string, cp: string, extra: Over = {}) => ({ id, circuitId, label: id, chargePointId: cp, ...extra });

describe("input contract", () => {
  it("keeps unknown (null) distinct from a deliberate zero and never defaults phases to three", () => {
    const parsed = input({ installation: { displayName: "A", mainRatingAmps: 0 }, circuits: [circuit("new-a", null), circuit("new-b", null, { ratingAmps: 0 })] });
    expect(parsed.installation.mainRatingAmps).toBe(0);
    expect(parsed.installation.mainPhaseCount).toBeNull();
    expect(parsed.circuits[0].ratingAmps).toBeNull();
    expect(parsed.circuits[0].phaseCount).toBeNull();
    expect(parsed.circuits[1].ratingAmps).toBe(0);
  });

  it("makes OEM, model and serial optional", () => {
    const parsed = input({ circuits: [circuit("new-a", null)], chargers: [charger("new-c", "new-a", "CP1")] });
    expect(parsed.chargers[0]).toMatchObject({ vendor: null, model: null, serialNumber: null });
  });

  it("rejects malformed email and phone but accepts them being absent", () => {
    expect(SaveInstallationInput.safeParse({ ...input(), electrician: { email: "not-an-email" } }).success).toBe(false);
    expect(SaveInstallationInput.safeParse({ ...input(), electrician: { phone: "12" } }).success).toBe(false);
    expect(SaveInstallationInput.safeParse({ ...input(), electrician: { name: "Jón", email: "jon@example.is", phone: "+354 555 1234" } }).success).toBe(true);
  });

  it("rejects a charge point id that is not a single safe path segment", () => {
    for (const bad of ["a/b", "a b", "../x", "", "x".repeat(49), "é"]) {
      const r = SaveInstallationInput.safeParse({ ...input({ circuits: [circuit("new-a", null)] }), chargers: [charger("new-c", "new-a", bad)] });
      expect(r.success, bad).toBe(false);
    }
  });

  it("requires a password of at least 12 characters when setting one", () => {
    expect(SaveInstallationInput.safeParse({ ...input(), password: { action: "set", value: "short" } }).success).toBe(false);
    expect(SaveInstallationInput.safeParse({ ...input(), password: { action: "set", value: "twelve-chars" } }).success).toBe(true);
  });
});

describe("effective allowance", () => {
  it("is zero when any rating on the path is unknown", () => {
    expect(effectiveAllowanceAmps([32, null, 63])).toEqual({ amps: 0, basis: "unknown" });
    expect(effectiveAllowanceAmps([null])).toEqual({ amps: 0, basis: "unknown" });
  });
  it("uses the smallest entered rating, and a deliberate zero stays an entered zero", () => {
    expect(effectiveAllowanceAmps([32, 63])).toEqual({ amps: 32, basis: "entered" });
    expect(effectiveAllowanceAmps([0, 63])).toEqual({ amps: 0, basis: "entered" });
  });
});

describe("planSave validation", () => {
  const plan = (over: Over, current = null as ReturnType<MemoryStore["snapshot"]>) => planSave(current, input(over));
  const problems = (over: Over) => {
    const r = plan(over);
    return r.ok ? [] : r.problems;
  };

  it("rejects a self-parent, an unknown parent and a cycle", () => {
    expect(problems({ circuits: [circuit("new-a", "new-a")] }).some((p) => /own parent/.test(p.message))).toBe(true);
    expect(problems({ circuits: [circuit("new-a", "new-zzz")] }).some((p) => /not found/.test(p.message))).toBe(true);
    expect(problems({ circuits: [circuit("new-a", "new-b"), circuit("new-b", "new-a")] }).some((p) => /loop/.test(p.message))).toBe(true);
  });

  it("rejects nesting deeper than the implementation bound", () => {
    const chain = Array.from({ length: 9 }, (_, i) => circuit(`new-${i}`, i === 0 ? null : `new-${i - 1}`));
    expect(problems({ circuits: chain }).some((p) => /levels/.test(p.message))).toBe(true);
    expect(problems({ circuits: chain.slice(0, 8) })).toEqual([]);
  });

  it("requires a charger to sit on a circuit of this installation and charge point ids to be unique", () => {
    expect(problems({ chargers: [charger("new-c", "elsewhere", "CP1")] }).some((p) => /circuit/.test(p.message))).toBe(true);
    const dup = problems({ circuits: [circuit("new-a", null)], chargers: [charger("new-1", "new-a", "CP1"), charger("new-2", "new-a", "cp1")] });
    expect(dup.some((p) => /used twice/.test(p.message))).toBe(true);
  });

  it("rejects an id that is neither stored nor new, without saying whether it exists elsewhere", () => {
    const r = plan({ circuits: [circuit(uuid(), null)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].message).toMatch(/Unknown circuit/);
  });
});

describe("saveInstallation", () => {
  it("creates an installation with no chargers and a stable key, and reads it back", async () => {
    const store = seeded();
    const res = await saveInstallation(store, input(), actor, deps());
    const i = res.snapshot.installation;
    expect(i.revision).toBe(1);
    expect(i.key).toBe("abcdefghjkmn");
    expect(res.snapshot.circuits).toEqual([]);
    expect(res.snapshot.chargers).toEqual([]);
    expect(i.passwordMode).toBe("unset");
    expect(res.responsibleStatus).toBe("not_provided");
  });

  it("keeps id and key across a rename and bumps the revision", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input(), actor, deps());
    const id = created.snapshot.installation.id;
    const renamed = await saveInstallation(
      store,
      input({ installationId: id, expectedRevision: 1, orgId: undefined, siteId: undefined, installation: { displayName: "Renamed" } }),
      actor,
      deps(),
    );
    expect(renamed.snapshot.installation).toMatchObject({ id, key: "abcdefghjkmn", displayName: "Renamed", revision: 2 });
    expect(connectionAddress("nordic-charge-ehf", renamed.snapshot.installation.key)).toBe("wss://nordic-charge-ehf.straumvakt.org/abcdefghjkmn/{charge-point-id}");
  });

  it("builds a tree with a sub-circuit and several chargers in one save, parents before children", async () => {
    const store = seeded();
    const res = await saveInstallation(
      store,
      input({
        installation: { displayName: "Depot", mainRatingAmps: 125, mainPhaseCount: 3 },
        circuits: [circuit("new-child", "new-root", { ratingAmps: 32, phaseCount: 3 }), circuit("new-root", null, { ratingAmps: 63 })],
        chargers: [charger("new-c1", "new-child", "CP1"), charger("new-c2", "new-child", "CP2"), charger("new-c3", "new-root", "CP3", { vendor: "Zaptec", serialNumber: "ZAP-1" })],
      }),
      actor,
      deps(),
    );
    const { circuits, chargers } = res.snapshot;
    const root = circuits.find((c) => c.displayName === "new-root")!;
    const child = circuits.find((c) => c.displayName === "new-child")!;
    expect(child.parentId).toBe(root.id);
    expect(chargers).toHaveLength(3);
    expect(chargers.filter((c) => c.circuitId === child.id)).toHaveLength(2);
    expect(chargers.find((c) => c.chargePointId === "CP3")).toMatchObject({ vendor: "Zaptec", model: null });
  });

  it("produces equal domain records whether the installation or the charger comes first", async () => {
    const a = seeded();
    const inline = await saveInstallation(a, input({ circuits: [circuit("new-a", null)], chargers: [charger("new-c", "new-a", "CP1")] }), actor, deps());
    const b = seeded();
    const first = await saveInstallation(b, input({ circuits: [circuit("new-a", null)] }), actor, deps());
    const ids = { id: first.snapshot.installation.id, circuit: first.snapshot.circuits[0].id };
    const later = await saveInstallation(
      b,
      input({ installationId: ids.id, expectedRevision: 1, orgId: undefined, siteId: undefined, circuits: [circuit(ids.circuit, null)], chargers: [charger("new-c", ids.circuit, "CP1")] }),
      actor,
      deps(),
    );
    const shape = (s: NonNullable<ReturnType<MemoryStore["snapshot"]>>) => s.chargers.map((c) => ({ label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber }));
    expect(shape(later.snapshot)).toEqual(shape(inline.snapshot));
  });

  it("refuses a stale revision and leaves the other operator's work intact", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input(), actor, deps());
    const id = created.snapshot.installation.id;
    const edit = (name: string, rev: number) => input({ installationId: id, expectedRevision: rev, orgId: undefined, siteId: undefined, installation: { displayName: name } });
    await saveInstallation(store, edit("Operator A", 1), actor, deps());
    const err = await saveInstallation(store, edit("Operator B", 1), actor, deps()).catch((e) => e);
    expect(err).toBeInstanceOf(SaveError);
    expect(err.code).toBe("stale_revision");
    expect(err.detail).toEqual({ currentRevision: 2 });
    expect(store.snapshot(id)!.installation.displayName).toBe("Operator A");
  });

  it("answers a replayed idempotency key without applying it twice", async () => {
    const store = seeded();
    const key = uuid();
    const first = await saveInstallation(store, input({ idempotencyKey: key, circuits: [circuit("new-a", null)] }), actor, deps());
    const again = await saveInstallation(store, input({ idempotencyKey: key, circuits: [circuit("new-a", null)] }), actor, deps());
    expect(again.replayed).toBe(true);
    expect(again.snapshot.installation.id).toBe(first.snapshot.installation.id);
    expect(store.state.installations.size).toBe(1);
    expect(store.state.circuits.size).toBe(1);
  });

  it("reports an unchanged save without creating a revision or history", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input(), actor, deps());
    const id = created.snapshot.installation.id;
    const before = store.state.changes.length;
    const same = await saveInstallation(store, input({ installationId: id, expectedRevision: 1, orgId: undefined, siteId: undefined }), actor, deps());
    expect(same.unchanged).toBe(true);
    expect(store.snapshot(id)!.installation.revision).toBe(1);
    expect(store.state.changes.length).toBe(before);
  });

  it("rolls back mutation and history together when a later step fails", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input({ circuits: [circuit("new-a", null)], chargers: [charger("new-c", "new-a", "CP1")] }), actor, deps());
    const snap = created.snapshot;
    const changesBefore = store.state.changes.length;
    // A new circuit is inserted, then the new charger reuses CP1 and fails.
    const err = await saveInstallation(
      store,
      input({
        installationId: snap.installation.id,
        expectedRevision: 1,
        orgId: undefined,
        siteId: undefined,
        installation: { displayName: "Should not stick" },
        circuits: [circuit(snap.circuits[0].id, null), circuit("new-b", null)],
        chargers: [charger(snap.chargers[0].id, snap.circuits[0].id, "CP1"), charger("new-d", "new-b", "CP1")],
      }),
      actor,
      deps(),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SaveError);
    expect(err.code).toBe("validation"); // duplicate charge point id inside the submission
    const after = store.snapshot(snap.installation.id)!;
    expect(after.installation.displayName).toBe("Harbour car park");
    expect(after.installation.revision).toBe(1);
    expect(after.circuits).toHaveLength(1);
    expect(store.state.changes.length).toBe(changesBefore);
  });

  it("rolls back a whole save when the store itself rejects part of it", async () => {
    const store = seeded();
    const a = await saveInstallation(store, input({ circuits: [circuit("new-a", null)], chargers: [charger("new-c", "new-a", "CP1", { serialNumber: "S-1" })] }), actor, { ...deps(), newKey: () => "keyaaaaaaaaa" });
    expect(a.snapshot.chargers).toHaveLength(1);
    // Second installation tries to register the same serial: refused, nothing else is created.
    const before = store.state.installations.size;
    const err = await saveInstallation(store, input({ circuits: [circuit("new-a", null)], chargers: [charger("new-c", "new-a", "CP9", { serialNumber: "s-1" })] }), actor, { ...deps(), newKey: () => "keybbbbbbbbb" }).catch((e) => e);
    expect(err.code).toBe("serial_in_use");
    expect(store.state.installations.size).toBe(before);
    expect(store.state.devices.size).toBe(1);
  });

  it("adds chargers alongside an existing one in a later save", async () => {
    const store = seeded();
    const res = await saveInstallation(store, input({ circuits: [circuit("new-a", null)], chargers: [charger("new-c", "new-a", "CP1")] }), actor, deps());
    const s = res.snapshot;
    const later = await saveInstallation(
      store,
      input({
        installationId: s.installation.id, expectedRevision: 1, orgId: undefined, siteId: undefined,
        circuits: [circuit(s.circuits[0].id, null)],
        chargers: [charger(s.chargers[0].id, s.circuits[0].id, "CP1"), charger("new-d", s.circuits[0].id, "CP1x"), { ...charger("new-e", s.circuits[0].id, "CP2") }],
      }),
      actor,
      deps(),
    );
    expect(later.snapshot.chargers).toHaveLength(3);
  });

  it("does not disclose another organisation's installation or accept a mismatched org", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input(), actor, deps());
    const err = await saveInstallation(
      store,
      input({ installationId: created.snapshot.installation.id, expectedRevision: 1, orgId: OTHER_ORG, siteId: undefined }),
      actor,
      deps(),
    ).catch((e) => e);
    expect(err.code).toBe("not_found");
    const unknown = await saveInstallation(store, input({ installationId: uuid(), expectedRevision: 1, orgId: undefined, siteId: undefined }), actor, deps()).catch((e) => e);
    expect(unknown.code).toBe("not_found");
    expect(unknown.message).toBe(err.message);
  });

  it("rejects a site that does not belong to the organisation", async () => {
    const store = seeded();
    const err = await saveInstallation(store, input({ orgId: OTHER_ORG }), actor, deps()).catch((e) => e);
    expect(err.code).toBe("not_found");
  });

  it("moves a charger between circuits, detaches a removed one and archives an emptied circuit", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input({ circuits: [circuit("new-a", null), circuit("new-b", null)], chargers: [charger("new-1", "new-a", "CP1"), charger("new-2", "new-b", "CP2")] }), actor, deps());
    const s = created.snapshot;
    const [ca, cb] = [s.circuits.find((c) => c.displayName === "new-a")!, s.circuits.find((c) => c.displayName === "new-b")!];
    const c1 = s.chargers.find((c) => c.chargePointId === "CP1")!;
    // CP1 moves to circuit b, CP2 is removed, circuit a (now empty) is removed.
    const res = await saveInstallation(
      store,
      input({ installationId: s.installation.id, expectedRevision: 1, orgId: undefined, siteId: undefined, circuits: [circuit(cb.id, null)], chargers: [charger(c1.id, cb.id, "CP1")] }),
      actor,
      deps(),
    );
    expect(res.snapshot.circuits.map((c) => c.id)).toEqual([cb.id]);
    expect(res.snapshot.chargers).toHaveLength(1);
    expect(res.snapshot.chargers[0]).toMatchObject({ id: c1.id, circuitId: cb.id });
    // History is preserved: the closed placements and the detached device still exist.
    expect(store.state.placements.filter((p) => p.deviceId === c1.id)).toHaveLength(2);
    expect(store.state.devices.size).toBe(2);
    expect(ca.id).not.toBe(cb.id);
  });

  it("allows a charge point id to be reused after its charger was removed in the same save", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input({ circuits: [circuit("new-a", null)], chargers: [charger("new-1", "new-a", "CP1")] }), actor, deps());
    const s = created.snapshot;
    const res = await saveInstallation(
      store,
      input({ installationId: s.installation.id, expectedRevision: 1, orgId: undefined, siteId: undefined, circuits: [circuit(s.circuits[0].id, null)], chargers: [charger("new-2", s.circuits[0].id, "CP1")] }),
      actor,
      deps(),
    );
    expect(res.snapshot.chargers).toHaveLength(1);
    expect(res.snapshot.chargers[0].id).not.toBe(s.chargers[0].id);
  });
});

describe("history, actor and electrician", () => {
  it("attributes every change to the shared login, never to the electrician, with before and after values", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input({ electrician: { name: "Jón Jónsson", email: "jon@example.is", phone: "+354 555 1234" } }), actor, deps());
    const id = created.snapshot.installation.id;
    await saveInstallation(store, input({ installationId: id, expectedRevision: 1, orgId: undefined, siteId: undefined, electrician: { name: "Anna Önnu", email: "jon@example.is", phone: "+354 555 1234" } }), actor, deps());
    expect(store.state.changes.every((c) => c.actorKind === "shared_login" && c.actorLabel === 'shared login "Straumvakt"')).toBe(true);
    expect(JSON.stringify(store.state.changes.map((c) => c.actorLabel))).not.toMatch(/Jón|Anna/);
    const change = store.state.changes.filter((c) => c.entityType === "electrician").at(-1)!;
    expect(change.diff.electricianName).toEqual({ from: "Jón Jónsson", to: "Anna Önnu" });
    expect(change.revision).toBe(2);
  });

  it("never marks the electrician confirmed, and any later edit keeps it unconfirmed", async () => {
    const store = seeded();
    const created = await saveInstallation(store, input({ electrician: { name: "Jón" } }), actor, deps());
    expect(created.responsibleStatus).toBe("not_confirmed");
    const edited = await saveInstallation(store, input({ installationId: created.snapshot.installation.id, expectedRevision: 1, orgId: undefined, siteId: undefined, electrician: { name: "Jón" }, installation: { displayName: "x" } }), actor, deps());
    expect(edited.responsibleStatus).toBe("not_confirmed");
    // Confirmation, once email exists, is bound to a revision.
    const i = edited.snapshot.installation;
    expect(responsibleStatus({ ...i, responsibleConfirmedRevision: 1 })).toBe("not_confirmed");
    expect(responsibleStatus({ ...i, responsibleConfirmedRevision: i.revision })).toBe("confirmed");
  });

  it("records the supplied effective time separately and refuses one in the future", async () => {
    const store = seeded();
    await saveInstallation(store, input({ effectiveAt: "2026-10-01T08:00:00Z" }), actor, deps());
    expect(store.state.changes[0].effectiveAt?.toISOString()).toBe("2026-10-01T08:00:00.000Z");
    const err = await saveInstallation(seeded(), input({ effectiveAt: "2027-01-01T00:00:00Z" }), actor, deps()).catch((e) => e);
    expect(err.code).toBe("validation");
  });
});

describe("password", () => {
  it("stores only a verifier, shows a generated password once, and keeps secrets out of history", async () => {
    const store = seeded();
    const res = await saveInstallation(store, input({ password: { action: "generate" } }), actor, deps());
    expect(res.generatedPassword).toBe("GENERATED-ONCE-0123456789");
    const inst = store.state.installations.get(res.snapshot.installation.id)!;
    expect(inst.passwordMode).toBe("password");
    expect(inst.verifier).toBe("verifier(25)");
    const serialised = JSON.stringify([store.state.changes, res.snapshot]);
    expect(serialised).not.toContain("GENERATED-ONCE");
    expect(serialised).not.toContain("verifier(");
    const pw = store.state.changes.find((c) => c.entityType === "password")!;
    expect(pw.diff).toEqual({ ocppPassword: { from: "unset", to: "configured" } });
  });

  it("records a deliberate no-password choice and does not return a password on a later read", async () => {
    const store = seeded();
    const res = await saveInstallation(store, input({ password: { action: "none" } }), actor, deps());
    expect(res.snapshot.installation.passwordMode).toBe("none");
    expect(res.generatedPassword).toBeUndefined();
  });

  it("hashes with salted PBKDF2, verifies, and rejects a wrong password", async () => {
    const stored = await hashInstallationPassword("correct horse battery");
    expect(stored).toMatch(/^pbkdf2:sha256:100000:/);
    expect(stored).not.toContain("correct horse");
    expect(await verifyInstallationPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyInstallationPassword("wrong horse battery!", stored)).toBe(false);
    expect(await hashInstallationPassword("correct horse battery")).not.toBe(stored);
  }, 20_000);

  it("generates long, distinct passwords", () => {
    const a = generateInstallationPassword();
    expect(a).toHaveLength(24);
    expect(generateInstallationPassword()).not.toBe(a);
  });
});

describe("routing identifiers", () => {
  it("derives a DNS-safe label from an Icelandic name and reserves infrastructure labels", () => {
    expect(routingLabelFromName("Hleðsla Þórðar ehf.")).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    expect(routingLabelFromName("!!")).toBe("cpo");
    for (const l of ["www", "api", "ocpp", "admin", "staging"]) expect(isReservedRoutingLabel(l)).toBe(true);
  });
  it("allocates distinct unambiguous installation keys independent of any name", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newInstallationKey()));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]{12}$/);
  });
});
