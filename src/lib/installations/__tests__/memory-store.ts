// In-memory Store for tests ONLY. It proves the service contract (ordering,
// rollback, replay, revision gate, error mapping). It does not prove any
// PostgreSQL behaviour: constraints, exclusion ranges, transactions and
// persistence are exercised only against a real target (see the run record).

import type { Amps, Phases, Snapshot } from "../model";
import { SaveError, type BootCaptureRow, type ChangeRow, type DiscoveryRow, type Draft, type DraftRow, type NewInstallationRow, type Store, type TxPort } from "../store";

type Inst = NewInstallationRow & { revision: number; passwordMode: "unset" | "none" | "password"; verifier: string | null; passwordSetAt: string | null; confirmed: number | null };
type Circ = { id: string; orgId: string; siteId: string; installationId: string; parentId: string | null; displayName: string; ratingAmps: Amps; phaseCount: Phases; sortOrder: number; archived: boolean; vendorRef?: string | null };
type Dev = { id: string; vendor: string | null; model: string | null; serialNumber: string | null };
type Ident = { deviceId: string; cpoOrgId: string; chargePointId: string; open: boolean };
type Place = { id: string; deviceId: string; orgId: string; installationId: string; siteId: string; circuitId: string; label: string; open: boolean };

type DraftRec = DraftRow & { orgId: string | null; actorKind: string };

type State = {
  orgs: Map<string, { name: string; routing: string | null }>;
  drafts: Map<string, DraftRec>;
  sites: Map<string, { orgId: string }>;
  /** ocpp.pending_discoveries, keyed exactly as stored: `{cpo-org-id}/{charge-point-id}` (or anything legacy). */
  discoveries: Map<string, { firstSeenAt: Date; lastSeenAt: Date; attemptCount: number; reason: string | null; boot?: BootCaptureRow; reasonAt?: Date; promote?: { at: Date; delivered: boolean; attempts: number; outcome: string | null } }>;
  installations: Map<string, Inst>;
  circuits: Map<string, Circ>;
  devices: Map<string, Dev>;
  identities: Ident[];
  placements: Place[];
  changes: ChangeRow[];
  seq: number;
};

const rowOf = (chargePointId: string, v: { firstSeenAt: Date; lastSeenAt: Date; attemptCount: number; reason: string | null; boot?: BootCaptureRow; reasonAt?: Date; promote?: { at: Date; delivered: boolean; attempts: number; outcome: string | null } }): DiscoveryRow => ({
  chargePointId, firstSeenAt: v.firstSeenAt, lastSeenAt: v.lastSeenAt, attemptCount: v.attemptCount, reason: v.reason,
  boot: v.boot ? { messageId: v.boot.messageId, receivedAt: new Date(v.boot.receivedAt) } : null,
  reasonAt: v.reasonAt ?? null, promote: v.promote ?? null,
});

export class MemoryStore implements Store {
  /** Test control: devices with a session in progress or an open guarded removal. */
  detachBlocked = new Set<string>();
  state: State = { orgs: new Map(), drafts: new Map(), sites: new Map(), discoveries: new Map(), installations: new Map(), circuits: new Map(), devices: new Map(), identities: [], placements: [], changes: [], seq: 0 };
  transactions = 0;
  /** Test control: when a registered charger last sent an accepted BootNotification, keyed `{cpo-org-id}/{lower-cased id}`. */
  bootAt = new Map<string, Date>();

  /** Test control: what the OCPP engine writes when an unknown charger knocks. `key` is the stored identity string. */
  seedDiscovery(key: string, over: Partial<{ firstSeenAt: Date; lastSeenAt: Date; attemptCount: number; reason: string | null; boot: BootCaptureRow; reasonAt: Date; promote: { at: Date; delivered: boolean; attempts: number; outcome: string | null } }> = {}) {
    this.state.discoveries.set(key, { firstSeenAt: new Date("2026-10-30T10:00:00Z"), lastSeenAt: new Date("2026-10-30T11:00:00Z"), attemptCount: 3, reason: null, ...over });
  }

  seedOrg(id: string, name: string, siteId: string) {
    this.state.orgs.set(id, { name, routing: null });
    this.state.sites.set(siteId, { orgId: id });
  }

  private clone(): State {
    const s = this.state;
    return {
      orgs: new Map([...s.orgs].map(([k, v]) => [k, { ...v }])),
      drafts: new Map([...s.drafts].map(([k, v]) => [k, { ...v, payload: structuredClone(v.payload) }])),
      sites: new Map([...s.sites].map(([k, v]) => [k, { ...v }])),
      discoveries: new Map([...s.discoveries].map(([k, v]) => [k, { ...v }])),
      installations: new Map([...s.installations].map(([k, v]) => [k, { ...v }])),
      circuits: new Map([...s.circuits].map(([k, v]) => [k, { ...v }])),
      devices: new Map([...s.devices].map(([k, v]) => [k, { ...v }])),
      identities: s.identities.map((i) => ({ ...i })),
      placements: s.placements.map((p) => ({ ...p })),
      changes: s.changes.map((c) => ({ ...c, diff: { ...c.diff } })),
      seq: s.seq,
    };
  }

  /** Test control: installations whose row is archived (the memory store has no archive column of its own). */
  archivedInstallations = new Set<string>();
  /** Emulates pg_advisory_xact_lock: a lock key is held until the end of the transaction that took it, and waiters queue behind it. */
  private locks = new Map<string, Promise<void>>();

  async transaction<T>(fn: (tx: TxPort) => Promise<T>): Promise<T> {
    this.transactions++;
    const before = this.clone();
    const releases: (() => void)[] = [];
    try {
      return await fn(this.port(releases));
    } catch (error) {
      this.state = before; // rollback
      throw error;
    } finally {
      for (const release of releases) release();
    }
  }

  snapshot(id: string): Snapshot | null {
    const i = this.state.installations.get(id);
    if (!i) return null;
    return {
      installation: {
        id: i.id, orgId: i.orgId, siteId: i.siteId, key: i.key, displayName: i.displayName, revision: i.revision,
        mainDeviceType: i.mainDeviceType, mainRatingAmps: i.mainRatingAmps, mainPhaseCount: i.mainPhaseCount, mainGridType: i.mainGridType,
        electrician: { name: i.electricianName, email: i.electricianEmail, phone: i.electricianPhone },
        electricianChangedRevision: i.electricianChangedRevision, responsibleConfirmedRevision: i.confirmed,
        passwordMode: i.passwordMode, passwordSetAt: i.passwordSetAt,
      },
      circuits: [...this.state.circuits.values()].filter((c) => c.installationId === id && !c.archived).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: c.ratingAmps, phaseCount: c.phaseCount, sortOrder: c.sortOrder })),
      ...(() => {
        const refs = Object.fromEntries([...this.state.circuits.values()].filter((c) => c.installationId === id && !c.archived && c.vendorRef).map((c) => [c.id, c.vendorRef as string]));
        return Object.keys(refs).length > 0 ? { vendorCircuitRefs: refs } : {};
      })(),
      chargers: this.state.placements.filter((p) => p.installationId === id && p.open).map((p) => {
        const d = this.state.devices.get(p.deviceId)!;
        const ident = this.state.identities.find((x) => x.deviceId === p.deviceId && x.open);
        return { id: d.id, placementId: p.id, circuitId: p.circuitId, label: p.label, chargePointId: ident?.chargePointId ?? "", vendor: d.vendor, model: d.model, serialNumber: d.serialNumber };
      }),
    };
  }

  draft(id: string): Draft | null {
    const r = this.state.drafts.get(id);
    if (!r) return null;
    const o = r.orgId ? this.state.orgs.get(r.orgId) : null;
    return { ...this.row(r), orgName: o?.name ?? null };
  }

  private row(r: DraftRec): DraftRow {
    return { id: r.id, orgId: r.orgId, state: r.state, payload: structuredClone(r.payload), revision: r.revision, installationId: r.installationId, actorLabel: r.actorLabel, createdAt: r.createdAt, updatedAt: r.updatedAt, closedAt: r.closedAt };
  }

  private port(releases: (() => void)[] = []): TxPort {
    const s = () => this.state;
    const nextId = () => `p-${++s().seq}`;
    return {
      lockVendorImport: async (orgId, vendor, externalRef) => {
        const key = `vendor-import:${orgId}:${vendor}:${externalRef}`;
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((resolve) => { release = resolve; });
        this.locks.set(key, previous.then(() => mine));
        await previous;
        releases.push(release);
        const found = [...s().installations.values()].find((i) => i.orgId === orgId && i.vendorImport?.vendor === vendor && i.vendorImport.externalRef === externalRef);
        return found ? { id: found.id, archived: this.archivedInstallations.has(found.id) } : null;
      },
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
      loadCpoOrganisation: async (orgId) => {
        const o = s().orgs.get(orgId);
        return o ? { displayName: o.name, routingId: o.routing } : null;
      },
      loadDraft: async (id) => this.draft(id),
      lockDraft: async (id) => {
        const r = s().drafts.get(id);
        return r ? this.row(r) : null;
      },
      countOpenDrafts: async () => [...s().drafts.values()].filter((d) => d.state === "open").length,
      listOpenDrafts: async (limit) =>
        [...s().drafts.values()].filter((d) => d.state === "open").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map((d) => this.draft(d.id)!),
      insertDraft: async (r) => {
        // The primary key the real table has.
        if (s().drafts.has(r.id)) throw new Error("unique violation: installation_drafts_pkey");
        const at = new Date(Date.UTC(2026, 9, 30, 12, 0, ++s().seq)).toISOString();
        s().drafts.set(r.id, { id: r.id, orgId: r.orgId, state: "open", payload: structuredClone(r.payload), revision: 1, installationId: null, actorKind: r.actorKind, actorLabel: r.actorLabel, createdAt: at, updatedAt: at, closedAt: null });
      },
      updateDraft: async (id, patch) => {
        const r = s().drafts.get(id);
        if (!r || r.state !== "open") throw new SaveError("draft_unavailable", "This draft was already used or discarded.");
        r.orgId = patch.orgId;
        r.payload = structuredClone(patch.payload);
        r.revision += 1;
        r.updatedAt = new Date(Date.UTC(2026, 9, 30, 12, 0, ++s().seq)).toISOString();
        return r.revision;
      },
      closeDraft: async (id, to, installationId) => {
        const r = s().drafts.get(id);
        if (!r || r.state !== "open") throw new SaveError("draft_unavailable", "This draft was already used or discarded.");
        r.state = to;
        r.installationId = installationId;
        r.closedAt = r.updatedAt = new Date(Date.UTC(2026, 9, 30, 13, 0, ++s().seq)).toISOString();
      },
      insertInstallation: async (r) => {
        if ([...s().installations.values()].some((i) => i.key === r.key)) throw new Error("unique violation: installations_installation_key_index"); s().installations.set(r.id, { ...r, revision: 1, passwordMode: "unset", verifier: null, passwordSetAt: null, confirmed: null }); },
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
        // One CPO, one charge point id, at most one open identity: whichever installation it is in.
        if (s().identities.some((i) => i.open && i.cpoOrgId === r.orgId && i.chargePointId === r.chargePointId)) throw new SaveError("identity_in_use", "identity in use");
        s().devices.set(r.deviceId, { id: r.deviceId, vendor: r.vendor, model: r.model, serialNumber: r.serialNumber });
        s().identities.push({ deviceId: r.deviceId, cpoOrgId: r.orgId, chargePointId: r.chargePointId, open: true });
        s().placements.push({ id: nextId(), deviceId: r.deviceId, orgId: r.orgId, installationId: r.installationId, siteId: r.siteId, circuitId: r.circuitId, label: r.label, open: true });
      },
      updateCharger: async (r) => {
        const { label, chargePointId, ...hw } = r.patch;
        if (hw.serialNumber && [...s().devices.values()].some((d) => d.id !== r.deviceId && d.serialNumber?.toLowerCase() === hw.serialNumber!.toLowerCase())) throw new SaveError("serial_in_use", "serial in use");
        Object.assign(s().devices.get(r.deviceId)!, hw);
        if (label !== undefined) s().placements.find((p) => p.deviceId === r.deviceId && p.open)!.label = label;
        if (chargePointId !== undefined) {
          if (s().identities.some((i) => i.open && i.cpoOrgId === r.orgId && i.chargePointId === chargePointId && i.deviceId !== r.deviceId)) throw new SaveError("identity_in_use", "identity in use");
          for (const i of s().identities) if (i.deviceId === r.deviceId && i.open) i.open = false;
          s().identities.push({ deviceId: r.deviceId, cpoOrgId: r.orgId, chargePointId, open: true });
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
      listDiscoveries: async (orgId, limit) => {
        const out: DiscoveryRow[] = [];
        for (const [key, v] of s().discoveries) {
          if (!key.startsWith(orgId + "/")) continue;
          const chargePointId = key.slice(orgId.length + 1);
          if (!/^[A-Za-z0-9._-]{1,48}$/.test(chargePointId)) continue;
          out.push(rowOf(chargePointId, v));
        }
        return out.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).slice(0, limit);
      },
      loadDiscovery: async (orgId, chargePointId) => {
        const v = s().discoveries.get(`${orgId}/${chargePointId}`);
        return v ? rowOf(chargePointId, v) : null;
      },
      markPromotion: async (orgId, chargePointId, at) => {
        const d = s().discoveries.get(`${orgId}/${chargePointId}`);
        if (d) d.promote = { at, delivered: false, attempts: 0, outcome: null };
      },
      recordPromotionOutcome: async (orgId, chargePointId, r) => {
        const d = s().discoveries.get(`${orgId}/${chargePointId}`);
        if (d?.promote) d.promote = { ...d.promote, delivered: r.delivered, outcome: r.outcome, attempts: d.promote.attempts + 1 };
      },
      lastBootAt: async (orgId, ids) => {
        const out = new Map<string, Date>();
        for (const id of ids) {
          const at = this.bootAt.get(`${orgId}/${id.toLowerCase()}`);
          if (at) out.set(id.toLowerCase(), at);
        }
        return out;
      },
      loadBootCapture: async (orgId, chargePointId) => s().discoveries.get(`${orgId}/${chargePointId}`)?.boot ?? null,
      knownChargePointIds: async (orgId, ids) => {
        const want = new Set(ids.map((x) => x.toLowerCase()));
        return new Set(s().identities.filter((i) => i.cpoOrgId === orgId && want.has(i.chargePointId.toLowerCase())).map((i) => i.chargePointId.toLowerCase()));
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
