// TEST-ONLY in-memory SyncRepo that counts every call and models the two
// counters' semantics (structure revision, installation status_version). It
// proves service logic and query shape only; PostgreSQL behaviour is separate.

import type { AccessPort, HistoryRow, SyncRepo } from "../service";
import type { ChargerView, CircuitView, DeviceStateView, InstallationView, Structure } from "../model";

type Inst = { id: string; name: string; revision: number; statusVersion: number; circuits: Map<string, CircuitView>; chargers: Map<string, ChargerView>; history: HistoryRow[]; devices: Map<string, DeviceStateView> };

export function memorySync() {
  const installs = new Map<string, Inst>();
  const calls: Record<string, number> = {};
  const hit = (n: string) => (calls[n] = (calls[n] ?? 0) + 1);
  const resetCalls = () => { for (const k of Object.keys(calls)) delete calls[k]; };

  const view = (i: Inst): InstallationView => ({ id: i.id, displayName: i.name, revision: i.revision, mainRatingAmps: null, mainPhaseCount: null });

  const repo: SyncRepo = {
    async versions(ids) { hit("versions"); return new Map(ids.filter((id) => installs.has(id)).map((id) => [id, { revision: installs.get(id)!.revision, statusVersion: installs.get(id)!.statusVersion }])); },
    async structure(id) { hit("structure"); const i = installs.get(id); return i ? { installation: view(i), circuits: [...i.circuits.values()], chargers: [...i.chargers.values()] } satisfies Structure : null; },
    async operational(id) { hit("operational"); return [...(installs.get(id)?.devices.values() ?? [])]; },
    async historyAfter(id, after, limit) { hit("historyAfter"); return (installs.get(id)?.history ?? []).filter((h) => h.revision > after).sort((a, b) => a.revision - b.revision).slice(0, limit); },
    async installationView(id) { hit("installationView"); const i = installs.get(id); return i ? view(i) : null; },
    async circuitsByIds(id, ids) { hit("circuitsByIds"); return ids.map((x) => installs.get(id)!.circuits.get(x)).filter((x): x is CircuitView => !!x); },
    async chargersByIds(id, ids) { hit("chargersByIds"); return ids.map((x) => installs.get(id)!.chargers.get(x)).filter((x): x is ChargerView => !!x); },
    async operationalMany(ids) { hit("operationalMany"); return new Map(ids.map((id) => [id, [...(installs.get(id)?.devices.values() ?? [])]])); },
    async operationalSince(id, after, limit) { hit("operationalSince"); return [...(installs.get(id)?.devices.values() ?? [])].filter((d) => d.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit); },
  };

  const world = {
    repo, calls, resetCalls,
    addInstallation(id: string, name = id) { installs.set(id, { id, name, revision: 1, statusVersion: 0, circuits: new Map(), chargers: new Map(), history: [{ revision: 1, entityType: "installation", entityId: id, action: "create" }], devices: new Map() }); },
    /** A committed structure save: one revision, one history row per changed entity. */
    save(id: string, edit: (i: Inst) => { entityType: string; entityId: string; action: string }[]) {
      const i = installs.get(id)!;
      i.revision += 1;
      for (const h of edit(i)) i.history.push({ revision: i.revision, ...h });
    },
    addCircuit(id: string, c: CircuitView) { world.save(id, (i) => { i.circuits.set(c.id, c); return [{ entityType: "circuit", entityId: c.id, action: "create" }]; }); },
    addCharger(id: string, c: ChargerView) { world.save(id, (i) => { i.chargers.set(c.id, c); return [{ entityType: "charger", entityId: c.id, action: "create" }]; }); },
    renameCharger(id: string, chargerId: string, label: string) { world.save(id, (i) => { i.chargers.set(chargerId, { ...i.chargers.get(chargerId)!, label }); return [{ entityType: "charger", entityId: chargerId, action: "update" }]; }); },
    detachCharger(id: string, chargerId: string) { world.save(id, (i) => { i.chargers.delete(chargerId); i.devices.delete(chargerId); return [{ entityType: "charger", entityId: chargerId, action: "detach" }]; }); },
    archiveCircuit(id: string, circuitId: string) { world.save(id, (i) => { i.circuits.delete(circuitId); return [{ entityType: "circuit", entityId: circuitId, action: "archive" }]; }); },
    /** A CHANGED device status: bumps status_version and stamps the row. Not a structure edit. */
    status(id: string, deviceId: string, status: string) {
      const i = installs.get(id)!;
      i.statusVersion += 1;
      i.devices.set(deviceId, { deviceId, connectors: { "1": { status, errorCode: "NoError", reportedAt: null } }, lastReportedAt: null, lastReceivedAt: "2026-10-29T12:00:00.000Z", seq: i.statusVersion });
    },
    revisionOf: (id: string) => installs.get(id)!.revision,
  };
  return world;
}

export function memoryAccess(grants: Record<string, string[] | null>): AccessPort<string> & { grants: Record<string, string[] | null> } {
  return { grants, async visible(actor) { const g = grants[actor]; return g ? { installationIds: g } : null; } };
}
