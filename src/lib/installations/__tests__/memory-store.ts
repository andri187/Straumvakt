// In-memory Store for tests ONLY. It proves the service contract (ordering,
// rollback, replay, revision gate, error mapping). It does not prove any
// PostgreSQL behaviour: constraints, exclusion ranges, transactions and
// persistence are exercised only against a real target (see the run record).

import type { Amps, Phases, Snapshot } from "../model";
import { SaveError, type ChangeRow, type NewInstallationRow, type Store, type TxPort } from "../store";

type Inst = NewInstallationRow & { revision: number; passwordMode: "unset" | "none" | "password"; verifier: string | null; passwordSetAt: string | null; confirmed: number | null };
type Circ = { id: string; orgId: string; siteId: string; installationId: string; parentId: string | null; displayName: string; ratingAmps: Amps; phaseCount: Phases; sortOrder: number; archived: boolean };
type Dev = { id: string; vendor: string | null; model: string | null; serialNumber: string | null };
type Ident = { deviceId: string; identity: string; open: boolean };
type Place = { id: string; deviceId: string; orgId: string; installationId: string; siteId: string; circuitId: string; label: string; open: boolean };

type State = {
  orgs: Map<string, { name: string; routing: string | null }>;
  sites: Map<string, { orgId: string }>;
  installations: Map<string, Inst>;
  circuits: Map<string, Circ>;
  devices: Map<string, Dev>;
  identities: Ident[];
  placements: Place[];
  changes: ChangeRow[];
  seq: number;
};

export class MemoryStore implements Store {
  /** Test control: devices with a session in progress or an open guarded removal. */
  detachBlocked = new Set<string>();
  state: State = { orgs: new Map(), sites: new Map(), installations: new Map(), circuits: new Map(), devices: new Map(), identities: [], placements: [], changes: [], seq: 0 };
  transactions = 0;

  seedOrg(id: string, name: string, siteId: string) {
    this.state.orgs.set(id, { name, routing: null });
    this.state.sites.set(siteId, { orgId: id });
  }

  private clone(): State {
    const s = this.state;
    return {
      orgs: new Map([...s.orgs].map(([k, v]) => [k, { ...v }])),
      sites: new Map([...s.sites].map(([k, v]) => [k, { ...v }])),
      installations: new Map([...s.installations].map(([k, v]) => [k, { ...v }])),
      circuits: new Map([...s.circuits].map(([k, v]) => [k, { ...v }])),
      devices: new Map([...s.devices].map(([k, v]) => [k, { ...v }])),
      identities: s.identities.map((i) => ({ ...i })),
      placements: s.placements.map((p) => ({ ...p })),
      changes: s.changes.map((c) => ({ ...c, diff: { ...c.diff } })),
      seq: s.seq,
    };
  }

  async transaction<T>(fn: (tx: TxPort) => Promise<T>): Promise<T> {
    this.transactions++;
    const before = this.clone();
    try {
      return await fn(this.port());
    } catch (error) {
      this.state = before; // rollback
      throw error;
    }
  }

  snapshot(id: string): Snapshot | null {
    const i = this.state.installations.get(id);
    if (!i) return null;
    const prefix = `${i.key}/`;
    return {
      installation: {
        id: i.id, orgId: i.orgId, siteId: i.siteId, key: i.key, displayName: i.displayName, revision: i.revision,
        mainDeviceType: i.mainDeviceType, mainRatingAmps: i.mainRatingAmps, mainPhaseCount: i.mainPhaseCount,
        electrician: { name: i.electricianName, email: i.electricianEmail, phone: i.electricianPhone },
        electricianChangedRevision: i.electricianChangedRevision, responsibleConfirmedRevision: i.confirmed,
        passwordMode: i.passwordMode, passwordSetAt: i.passwordSetAt,
      },
      circuits: [...this.state.circuits.values()].filter((c) => c.installationId === id && !c.archived).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: c.ratingAmps, phaseCount: c.phaseCount, sortOrder: c.sortOrder })),
      chargers: this.state.placements.filter((p) => p.installationId === id && p.open).map((p) => {
        const d = this.state.devices.get(p.deviceId)!;
        const ident = this.state.identities.find((x) => x.deviceId === p.deviceId && x.open);
        return { id: d.id, placementId: p.id, circuitId: p.circuitId, label: p.label, chargePointId: ident?.identity.startsWith(prefix) ? ident.identity.slice(prefix.length) : "", vendor: d.vendor, model: d.model, serialNumber: d.serialNumber };
      }),
    };
  }

  private port(): TxPort {
    const s = () => this.state;
    const nextId = () => `p-${++s().seq}`;
    return {
      findReplay: async (key) => s().changes.find((c) => c.idempotencyKey === key)?.installationId ?? null,
      loadSnapshot: async (id) => this.snapshot(id),
      loadSite: async (siteId, orgId) => {
        const site = s().sites.get(siteId);
        const org = s().orgs.get(orgId);
        return site && org && site.orgId === orgId ? { orgDisplayName: org.name, routingId: org.routing } : null;
      },
      ensureRoutingId: async (orgId, name) => {
        const o = s().orgs.get(orgId)!;
        o.routing ??= name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return o.routing;
      },
      insertInstallation: async (r) => { s().installations.set(r.id, { ...r, revision: 1, passwordMode: "unset", verifier: null, passwordSetAt: null, confirmed: null }); },
      bumpRevision: async (id, expected) => {
        const i = s().installations.get(id);
        if (!i || i.revision !== expected) return null;
        i.revision += 1;
        return i.revision;
      },
      patchInstallation: async (id, patch) => { Object.assign(s().installations.get(id)!, patch); },
      setPassword: async (id, mode, verifier) => { const i = s().installations.get(id)!; i.passwordMode = mode; i.verifier = verifier; i.passwordSetAt = "2026-10-29T00:00:00.000Z"; },
      insertCircuit: async (r) => {
        if (r.parentId && s().circuits.get(r.parentId)?.installationId !== r.installationId) throw new SaveError("validation", "parent not in installation");
        s().circuits.set(r.id, { ...r, archived: false });
      },
      updateCircuit: async (id, patch) => { Object.assign(s().circuits.get(id)!, patch); },
      archiveCircuit: async (id) => {
        const hasKid = [...s().circuits.values()].some((c) => c.parentId === id && !c.archived);
        const hasCharger = s().placements.some((p) => p.circuitId === id && p.open);
        if (hasKid || hasCharger) throw new SaveError("validation", "not empty");
        s().circuits.get(id)!.archived = true;
      },
      attachCharger: async (r) => {
        const c = s().circuits.get(r.circuitId);
        if (!c || c.installationId !== r.installationId || c.archived) throw new SaveError("validation", "circuit not in installation");
        if (r.serialNumber && [...s().devices.values()].some((d) => d.serialNumber?.toLowerCase() === r.serialNumber!.toLowerCase())) throw new SaveError("serial_in_use", "serial in use");
        const identity = `${r.installationKey}/${r.chargePointId}`;
        if (s().identities.some((i) => i.open && i.identity === identity)) throw new SaveError("identity_in_use", "identity in use");
        s().devices.set(r.deviceId, { id: r.deviceId, vendor: r.vendor, model: r.model, serialNumber: r.serialNumber });
        s().identities.push({ deviceId: r.deviceId, identity, open: true });
        s().placements.push({ id: nextId(), deviceId: r.deviceId, orgId: r.orgId, installationId: r.installationId, siteId: r.siteId, circuitId: r.circuitId, label: r.label, open: true });
      },
      updateCharger: async (r) => {
        const { label, chargePointId, ...hw } = r.patch;
        if (hw.serialNumber && [...s().devices.values()].some((d) => d.id !== r.deviceId && d.serialNumber?.toLowerCase() === hw.serialNumber!.toLowerCase())) throw new SaveError("serial_in_use", "serial in use");
        Object.assign(s().devices.get(r.deviceId)!, hw);
        if (label !== undefined) s().placements.find((p) => p.deviceId === r.deviceId && p.open)!.label = label;
        if (chargePointId !== undefined) {
          const identity = `${r.installationKey}/${chargePointId}`;
          if (s().identities.some((i) => i.open && i.identity === identity && i.deviceId !== r.deviceId)) throw new SaveError("identity_in_use", "identity in use");
          for (const i of s().identities) if (i.deviceId === r.deviceId && i.open) i.open = false;
          s().identities.push({ deviceId: r.deviceId, identity, open: true });
        }
      },
      moveCharger: async (r) => {
        const old = s().placements.find((p) => p.id === r.placementId && p.open);
        if (!old) throw new SaveError("validation", "placement changed");
        old.open = false;
        s().placements.push({ id: nextId(), deviceId: r.deviceId, orgId: r.orgId, installationId: r.installationId, siteId: r.siteId, circuitId: r.circuitId, label: r.label, open: true });
      },
      detachBlockReason: async (id) => (this.detachBlocked.has(id) ? "This charger has a session in progress or a removal already open. Use Remove charger, which stops and settles the session, instead of deleting it here." : null),
      detachCharger: async (r) => {
        const p = s().placements.find((x) => x.id === r.placementId);
        if (p) p.open = false;
        for (const i of s().identities) if (i.deviceId === r.deviceId && i.open) i.open = false;
      },
      insertChanges: async (rows) => {
        for (const row of rows) {
          if (row.idempotencyKey && s().changes.some((c) => c.idempotencyKey === row.idempotencyKey)) throw new Error("unique violation: idempotency_key");
          s().changes.push(row);
        }
      },
    };
  }
}
