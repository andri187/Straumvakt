// Snapshot and incremental-changes service (Checkpoint D). Pure over ports.
//
// Every call, snapshot or delta, starts by RESOLVING EFFECTIVE ACCESS again.
// Nothing is granted from a cursor, an ETag or a cached entry: those only say
// what the client already holds. Losing access to one installation changes the
// scope hash, which makes every older cursor `reset_required` - the client then
// evicts and refetches only what it can still see, and never receives a removal
// message for something it was not entitled to.
//
// Query budget, by design (see service.test.ts for the measured counts):
//   snapshot, cold         1 access + 1 version probe + per installation: 1 structure + 1 operational
//   snapshot, warm cache   1 access + 1 version probe + per installation: 1 operational
//   changes, nothing new   1 access + 1 version probe
//   one status update      + 1 operational-since query; the tree is NOT read
//   one structure edit     + 1 history query + 1 query per changed entity TYPE (not per row)

import { StructureCache } from "./cache";
import {
  CURSOR_MAX_AGE_MS,
  MAX_CHANGES_PER_INSTALLATION,
  MAX_OPERATIONAL_PER_PAGE,
  MAX_SCOPE_INSTALLATIONS,
  SYNC_SCHEMA,
  decodeCursor,
  encodeCursor,
  scopeHash,
  type Change,
  type ChangesResponse,
  type ChargerView,
  type CircuitView,
  type Cursor,
  type DeviceStateView,
  type InstallationView,
  type Position,
  type Projection,
  type SnapshotResponse,
  type Structure,
} from "./model";

export interface AccessPort<Actor> {
  /** Effective, current visibility. Null = no access at all. Never cached by the service. */
  visible(actor: Actor): Promise<{ installationIds: string[] } | null>;
}

export type HistoryRow = { revision: number; entityType: string; entityId: string | null; action: string };

export interface SyncRepo {
  /** The cheap probe: two integers per installation, by primary key. */
  versions(ids: string[]): Promise<Map<string, { revision: number; statusVersion: number }>>;
  structure(id: string): Promise<Structure | null>;
  operational(id: string): Promise<DeviceStateView[]>;
  historyAfter(id: string, afterRevision: number, limit: number): Promise<HistoryRow[]>;
  installationView(id: string): Promise<InstallationView | null>;
  circuitsByIds(installationId: string, ids: string[]): Promise<CircuitView[]>;
  chargersByIds(installationId: string, ids: string[]): Promise<ChargerView[]>;
  operationalSince(id: string, afterSeq: number, limit: number): Promise<DeviceStateView[]>;
}

export type SyncDeps<Actor> = {
  access: AccessPort<Actor>;
  repo: SyncRepo;
  cache: StructureCache;
  now: () => number;
  /** 0 = always probe (default). >0 = serve a structure validated this recently without a probe. */
  trustStructureForMs?: number;
};

const PROJECTION: Projection = "cpo-admin";

export type SnapshotResult = { kind: "snapshot"; body: SnapshotResponse; etag: string } | { kind: "not_modified"; etag: string } | { kind: "forbidden" } | { kind: "too_many" };

/** Entity tag from versions only, so a conditional request never needs the tree. */
function etagFor(scope: string, versions: Map<string, { revision: number; statusVersion: number }>, ids: string[]): string {
  const parts = [...ids].sort().map((id) => `${id.slice(0, 8)}:${versions.get(id)?.revision ?? 0}.${versions.get(id)?.statusVersion ?? 0}`);
  return `W/"${scope}-${parts.join("-")}"`;
}

export async function readSnapshot<Actor>(deps: SyncDeps<Actor>, actor: Actor, ifNoneMatch?: string | null): Promise<SnapshotResult> {
  const vis = await deps.access.visible(actor);
  if (!vis) return { kind: "forbidden" };
  const ids = [...new Set(vis.installationIds)].sort();
  if (ids.length > MAX_SCOPE_INSTALLATIONS) return { kind: "too_many" };
  const scope = await scopeHash(PROJECTION, ids);

  // Versions are read BEFORE the data, so the cursor can only be older than what
  // the data reflects. Anything in between is replayed by the next delta, and a
  // versioned upsert applied twice is the same as applied once.
  const versions = ids.length ? await deps.repo.versions(ids) : new Map();
  const etag = etagFor(scope, versions, ids);
  if (ifNoneMatch && ifNoneMatch === etag) return { kind: "not_modified", etag };

  const installations: SnapshotResponse["installations"] = [];
  const pos: Record<string, Position> = {};
  for (const id of ids) {
    const v = versions.get(id);
    if (!v) continue; // visible but gone: simply not part of the scope's content
    pos[id] = { rev: v.revision, sv: v.statusVersion };
    let structure = deps.cache.get(PROJECTION, id, v.revision, deps.trustStructureForMs ?? 0);
    if (!structure) {
      structure = await deps.repo.structure(id);
      if (!structure) continue;
      deps.cache.put(PROJECTION, id, structure);
    }
    installations.push({ structure, devices: await deps.repo.operational(id) });
  }
  const cursor: Cursor = { v: SYNC_SCHEMA, scope, at: deps.now(), pos };
  return { kind: "snapshot", etag, body: { schema: SYNC_SCHEMA, projection: PROJECTION, cursor: encodeCursor(cursor), installations } };
}

export type ChangesResult = { kind: "changes"; body: ChangesResponse; etag?: string } | { kind: "forbidden" };

export async function readChanges<Actor>(deps: SyncDeps<Actor>, actor: Actor, cursorText: string): Promise<ChangesResult> {
  const vis = await deps.access.visible(actor);
  if (!vis) return { kind: "forbidden" };
  const reset = (reason: "scope_changed" | "cursor_expired" | "cursor_invalid" | "too_many_installations"): ChangesResult => ({ kind: "changes", body: { schema: SYNC_SCHEMA, resetRequired: reason } });

  const prev = decodeCursor(cursorText);
  if (!prev) return reset("cursor_invalid");
  const ids = [...new Set(vis.installationIds)].sort();
  if (ids.length > MAX_SCOPE_INSTALLATIONS) return reset("too_many_installations");
  if (prev.scope !== (await scopeHash(PROJECTION, ids))) return reset("scope_changed");
  const t = deps.now();
  if (t - prev.at > CURSOR_MAX_AGE_MS || prev.at > t + 60_000) return reset("cursor_expired");

  const versions = ids.length ? await deps.repo.versions(ids) : new Map();
  const changes: Change[] = [];
  const pos: Record<string, Position> = { ...prev.pos };
  let hasMore = false;

  for (const id of ids) {
    const v = versions.get(id);
    const from = prev.pos[id] ?? { rev: 0, sv: 0 };
    if (!v) continue;

    if (v.revision > from.rev) {
      // The feed is authoritative: a cached structure older than this is overtaken.
      deps.cache.evictBelow(id, v.revision);
      const rows = await deps.repo.historyAfter(id, from.rev, MAX_CHANGES_PER_INSTALLATION + 1);
      let usable = rows;
      let newRev = v.revision;
      if (rows.length > MAX_CHANGES_PER_INSTALLATION) {
        // Cut on a whole-revision boundary so a revision is never half-delivered.
        const lastRev = rows[rows.length - 1]!.revision;
        usable = rows.filter((r) => r.revision < lastRev);
        newRev = usable.length ? usable[usable.length - 1]!.revision : from.rev;
        hasMore = true;
      } else if (rows.length > 0) {
        newRev = Math.max(v.revision, rows[rows.length - 1]!.revision);
      }
      changes.push(...(await structureChanges(deps.repo, id, usable)));
      pos[id] = { ...pos[id]!, rev: Math.max(newRev, from.rev) };
      if (!hasMore) pos[id] = { ...pos[id]!, rev: Math.max(v.revision, pos[id]!.rev) };
    } else {
      pos[id] = { ...(pos[id] ?? from), rev: Math.max(from.rev, 0) };
    }

    if (v.statusVersion > from.sv) {
      const rows = await deps.repo.operationalSince(id, from.sv, MAX_OPERATIONAL_PER_PAGE + 1);
      const page = rows.slice(0, MAX_OPERATIONAL_PER_PAGE);
      if (rows.length > MAX_OPERATIONAL_PER_PAGE) hasMore = true;
      for (const d of page) changes.push({ kind: "operational", installationId: id, entity: "device_state", id: d.deviceId, version: d.seq, op: "upsert", data: d });
      const maxSeq = page.reduce((m, d) => Math.max(m, d.seq), 0);
      pos[id] = { ...(pos[id] ?? from), sv: rows.length > MAX_OPERATIONAL_PER_PAGE ? maxSeq : Math.max(v.statusVersion, maxSeq, from.sv) };
    }
    pos[id] = { rev: pos[id]?.rev ?? from.rev, sv: pos[id]?.sv ?? from.sv };
  }

  const next: Cursor = { v: SYNC_SCHEMA, scope: prev.scope, at: prev.at, pos };
  // `at` is deliberately NOT advanced: a cursor ages out 7 days after the SNAPSHOT it descends from, so a client can never drift forever on a feed we no longer vouch for. It re-snapshots instead.
  return { kind: "changes", body: { schema: SYNC_SCHEMA, cursor: encodeCursor(next), changes, hasMore } };
}

async function structureChanges(repo: SyncRepo, installationId: string, rows: HistoryRow[]): Promise<Change[]> {
  // Collapse to the LAST row per entity: only the final state matters, and a create followed by an archive is just a removal.
  const last = new Map<string, HistoryRow>();
  for (const r of rows) {
    if (!r.entityId) continue;
    if (r.entityType !== "installation" && r.entityType !== "circuit" && r.entityType !== "charger") continue; // electrician/password rows carry nothing a view shows
    last.set(`${r.entityType}:${r.entityId}`, r);
  }
  const out: Change[] = [];
  const wantCircuits: HistoryRow[] = [];
  const wantChargers: HistoryRow[] = [];
  // ANY saved revision moves the installation's own `revision`, which the client sends back as
  // expectedRevision. So the installation view always rides along - even when only a charger or
  // a hidden field (electrician, password) changed - or the next save would conflict needlessly.
  let installationRev = rows.length > 0 ? rows[rows.length - 1]!.revision : 0;
  for (const r of last.values()) {
    const removed = (r.entityType === "circuit" && r.action === "archive") || (r.entityType === "charger" && r.action === "detach");
    if (removed) out.push({ kind: "structure", installationId, entity: r.entityType as "circuit" | "charger", id: r.entityId!, version: r.revision, op: "remove" });
    else if (r.entityType === "circuit") wantCircuits.push(r);
    else if (r.entityType === "charger") wantChargers.push(r);
    else installationRev = Math.max(installationRev, r.revision);
  }
  if (installationRev > 0) {
    const view = await repo.installationView(installationId);
    if (view) out.push({ kind: "structure", installationId, entity: "installation", id: installationId, version: view.revision, op: "upsert", data: view });
  }
  if (wantCircuits.length) {
    const byId = new Map((await repo.circuitsByIds(installationId, wantCircuits.map((r) => r.entityId!))).map((c) => [c.id, c]));
    for (const r of wantCircuits) {
      const data = byId.get(r.entityId!);
      // Gone by the time we looked (archived later in the same page): the later row says so; nothing to upsert.
      if (data) out.push({ kind: "structure", installationId, entity: "circuit", id: data.id, version: r.revision, op: "upsert", data });
    }
  }
  if (wantChargers.length) {
    const byId = new Map((await repo.chargersByIds(installationId, wantChargers.map((r) => r.entityId!))).map((c) => [c.id, c]));
    for (const r of wantChargers) {
      const data = byId.get(r.entityId!);
      if (data) out.push({ kind: "structure", installationId, entity: "charger", id: data.id, version: r.revision, op: "upsert", data });
    }
  }
  return out.sort((a, b) => a.version - b.version);
}
