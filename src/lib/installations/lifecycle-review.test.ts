import { describe, expect, it } from "vitest";
import { sharedLoginActor } from "./actor";
import { MemoryStore } from "./__tests__/memory-store";
import { SaveInstallationInput } from "./model";
import { saveInstallation } from "./service";

const orgId = "11111111-1111-4111-8111-111111111111";
const siteId = "33333333-3333-4333-8333-333333333333";
const actor = sharedLoginActor("Straumvakt");
const circuit = (id: string) => ({ id, parentId: null, displayName: "Circuit" });
const charger = (id: string, circuitId: string, serialNumber: string | null) => ({ id, circuitId, label: "Charger", chargePointId: "CP1", serialNumber });
const input = (over: Record<string, unknown> = {}) => SaveInstallationInput.parse({
  orgId, siteId, idempotencyKey: crypto.randomUUID(),
  installation: { displayName: "Installation" }, electrician: {}, circuits: [], chargers: [], ...over,
});
const makeStore = () => { const s = new MemoryStore(); s.seedOrg(orgId, "Example CPO", siteId); return s; };
const save = (s: MemoryStore, over: Record<string, unknown>) => saveInstallation(s, input(over), actor);

describe("installation lifecycle review", () => {
  it.each([true, false])("remove then re-add a charger, serial present: %s", async (hasSerial) => {
    const s = makeStore();
    const serial = hasSerial ? "SERIAL-1" : null;
    const created = await save(s, { circuits: [circuit("new-circuit")], chargers: [charger("new-charger", "new-circuit", serial)] });
    const first = created.snapshot;
    const id = first.installation.id, circuitId = first.circuits[0].id, deviceId = first.chargers[0].id;
    const edit = (revision: number, chargers: unknown[]) => ({ installationId: id, expectedRevision: revision, orgId: undefined, siteId: undefined, circuits: [circuit(circuitId)], chargers });
    expect(s.state.placements.filter((p) => p.open)).toHaveLength(1);
    const removed = await save(s, edit(1, []));
    expect(removed.snapshot.chargers).toHaveLength(0);
    expect(s.state.devices.has(deviceId)).toBe(true);
    expect(s.state.placements.filter((p) => p.deviceId === deviceId && p.open)).toHaveLength(0);
    expect(s.state.identities.filter((i) => i.deviceId === deviceId && i.open)).toHaveLength(0);
    expect(s.state.changes.some((c) => c.entityId === deviceId && c.action === "detach")).toBe(true);
    if (hasSerial) {
      await expect(save(s, edit(2, [charger("new-again", circuitId, serial)]))).rejects.toMatchObject({ code: "serial_in_use" });
      await expect(save(s, edit(2, [charger(deviceId, circuitId, serial)]))).rejects.toMatchObject({ code: "validation" });
      expect(s.snapshot(id)!.installation.revision).toBe(2);
      expect(s.state.devices.size).toBe(1);
    } else {
      const added = await save(s, edit(2, [charger("new-again", circuitId, null)]));
      expect(added.snapshot.chargers).toHaveLength(1);
      expect(added.snapshot.chargers[0].id).not.toBe(deviceId);
      expect(s.state.devices.size).toBe(2);
      expect(s.state.identities.filter((i) => i.open)).toHaveLength(1);
    }
  });

  it("does not replace a removed charger with the same serial in one save", async () => {
    const s = makeStore();
    const first = (await save(s, { circuits: [circuit("new-a")], chargers: [charger("new-charger", "new-a", "SERIAL-3")] })).snapshot;
    const id = first.installation.id, circuitId = first.circuits[0].id, deviceId = first.chargers[0].id;
    await expect(save(s, { installationId: id, expectedRevision: 1, orgId: undefined, siteId: undefined, circuits: [circuit(circuitId)], chargers: [charger("new-replacement", circuitId, "SERIAL-3")] })).rejects.toMatchObject({ code: "serial_in_use" });
    expect(s.snapshot(id)!.installation.revision).toBe(1);
    expect(s.snapshot(id)!.chargers[0].id).toBe(deviceId);
    expect(s.state.placements.filter((p) => p.open)).toHaveLength(1);
  });

  it("keeps identity and opens a new placement when moved between circuits", async () => {
    const s = makeStore();
    const first = (await save(s, { circuits: [circuit("new-a"), circuit("new-b")], chargers: [charger("new-charger", "new-a", "SERIAL-2")] })).snapshot;
    const [a, b] = first.circuits;
    const device = first.chargers[0];
    const moved = await save(s, { installationId: first.installation.id, expectedRevision: 1, orgId: undefined, siteId: undefined, circuits: [circuit(a.id), circuit(b.id)], chargers: [charger(device.id, b.id, "SERIAL-2")] });
    expect(moved.snapshot.chargers[0]).toMatchObject({ id: device.id, circuitId: b.id });
    expect(s.state.placements.filter((p) => p.deviceId === device.id)).toHaveLength(2);
    expect(s.state.placements.filter((p) => p.deviceId === device.id && p.open)).toHaveLength(1);
    expect(s.state.identities.filter((i) => i.deviceId === device.id && i.open)).toHaveLength(1);
  });
});

// ── Lifecycle guard (added with the guarded removal path) ────────────────────
describe("plain save cannot orphan a session", () => {
  it("refuses to detach a charger with a session in progress or an open removal, rolls back wholly, and allows it once cleared", async () => {
    const store = new MemoryStore();
    const ORG = "11111111-1111-4111-8111-111111111111";
    const SITE = "33333333-3333-4333-8333-333333333333";
    store.seedOrg(ORG, "Nordic Charge", SITE);
    const actor = sharedLoginActor("T");
    const base = { orgId: ORG, siteId: SITE, installation: { displayName: "Harbour" }, electrician: {}, circuits: [{ id: "new-c", parentId: null, displayName: "Main", ratingAmps: 32, phaseCount: 3, sortOrder: 0 }] };
    const created = await saveInstallation(store, SaveInstallationInput.parse({ ...base, idempotencyKey: crypto.randomUUID(), chargers: [{ id: "new-1", circuitId: "new-c", label: "Bay", chargePointId: "CP1", vendor: null, model: null, serialNumber: null }] }), actor);
    const inst = created.snapshot.installation;
    const charger = created.snapshot.chargers[0]!;
    const circuit = created.snapshot.circuits[0]!;
    const without = (key: string) => SaveInstallationInput.parse({ ...base, installationId: inst.id, expectedRevision: inst.revision, idempotencyKey: key, circuits: [{ id: circuit.id, parentId: null, displayName: "Main", ratingAmps: 32, phaseCount: 3, sortOrder: 0 }], chargers: [] });
    store.detachBlocked.add(charger.id);
    await expect(saveInstallation(store, without(crypto.randomUUID()), actor)).rejects.toMatchObject({ code: "validation" });
    expect(store.snapshot(inst.id)!.chargers).toHaveLength(1); // nothing detached
    expect(store.snapshot(inst.id)!.installation.revision).toBe(inst.revision); // no revision spent
    store.detachBlocked.clear();
    const ok = await saveInstallation(store, without(crypto.randomUUID()), actor);
    expect(ok.snapshot.chargers).toHaveLength(0);
  });
});
