// Client-side merge adapter (Checkpoint D). Framework-free; the web console and
// the mobile app both use it, each with its own storage and rendering.
//
// Rules, all deterministic and local:
//   - versioned upsert: an incoming entity replaces the held one only if its
//     version is HIGHER; an old or duplicate message changes nothing;
//   - a tombstone records the removal version, so an older upsert delivered
//     late cannot resurrect a removed entity;
//   - reset_required (or logout, or a scope change) drops EVERYTHING; the
//     caller then fetches a snapshot of what it may still see;
//   - an entity the user is editing is never overwritten: the remote value is
//     parked as `pendingRemote` for the UI to show. The server's
//     expectedRevision check still decides at save time;
//   - the adapter holds no credentials and grants nothing: it is a cache of what
//     the server already authorised.

import type { Change, ChangesResponse, DeviceStateView, SnapshotResponse } from "./model";

export type Held = { version: number; removed: boolean; data: unknown };
export type MergeStatus = "applied" | "stale_ignored" | "deferred_dirty";

export class SyncClient {
  cursor: string | null = null;
  private readonly entities = new Map<string, Held>();
  private readonly installationIds = new Set<string>();
  private readonly dirty = new Set<string>();
  readonly pendingRemote = new Map<string, Held>();

  private k(entity: string, id: string): string {
    return `${entity}:${id}`;
  }

  /** The UI marks an entity as being edited (unsaved) and clears it after save or discard. */
  markDirty(entity: string, id: string): void {
    this.dirty.add(this.k(entity, id));
  }
  clearDirty(entity: string, id: string): void {
    this.dirty.delete(this.k(entity, id));
    const key = this.k(entity, id);
    const parked = this.pendingRemote.get(key);
    if (parked) {
      this.upsert(key, parked.version, parked.removed, parked.data);
      this.pendingRemote.delete(key);
    }
  }

  get<T>(entity: string, id: string): T | null {
    const h = this.entities.get(this.k(entity, id));
    return h && !h.removed ? (h.data as T) : null;
  }

  list<T>(entity: string, installationId?: string): T[] {
    const out: T[] = [];
    for (const [key, h] of this.entities) {
      if (h.removed || !key.startsWith(`${entity}:`)) continue;
      const d = h.data as { installationId?: string };
      if (installationId && d.installationId !== undefined && d.installationId !== installationId) continue;
      out.push(h.data as T);
    }
    return out;
  }

  held(entity: string, id: string): Held | undefined {
    return this.entities.get(this.k(entity, id));
  }

  /** Drop everything: logout, scope change, reset_required. */
  clear(): void {
    this.cursor = null;
    this.entities.clear();
    this.installationIds.clear();
    this.dirty.clear();
    this.pendingRemote.clear();
  }

  applySnapshot(s: SnapshotResponse): void {
    // A snapshot REPLACES the picture for its scope. Dirty drafts are not the client's entity cache, so they survive.
    const parkedDirty = new Set(this.dirty);
    this.entities.clear();
    this.installationIds.clear();
    this.pendingRemote.clear();
    for (const inst of s.installations) {
      this.installationIds.add(inst.structure.installation.id);
      this.seed("installation", inst.structure.installation.id, inst.structure.installation.revision, inst.structure.installation);
      for (const c of inst.structure.circuits) this.seed("circuit", c.id, inst.structure.installation.revision, { ...c, installationId: inst.structure.installation.id });
      for (const c of inst.structure.chargers) this.seed("charger", c.id, inst.structure.installation.revision, { ...c, installationId: inst.structure.installation.id });
      for (const d of inst.devices) this.seed("device_state", d.deviceId, d.seq, d);
    }
    this.dirty.clear();
    for (const d of parkedDirty) this.dirty.add(d);
    this.cursor = s.cursor;
  }

  private seed(entity: string, id: string, version: number, data: unknown): void {
    this.entities.set(this.k(entity, id), { version, removed: false, data });
  }

  /** Returns "reset" when the caller must refetch a snapshot; otherwise a per-change merge report. */
  applyChanges(r: ChangesResponse): "reset" | { merged: { key: string; status: MergeStatus }[]; hasMore: boolean } {
    if ("resetRequired" in r) {
      this.clear();
      return "reset";
    }
    const merged = r.changes.map((c) => ({ key: this.k(c.entity, c.id), status: this.mergeOne(c) }));
    this.cursor = r.cursor;
    return { merged, hasMore: r.hasMore };
  }

  private mergeOne(c: Change): MergeStatus {
    const key = this.k(c.entity, c.id);
    const removed = c.op === "remove";
    const data = c.op === "upsert" ? (c.kind === "structure" && c.entity !== "installation" ? { ...c.data, installationId: c.installationId } : c.data) : null;
    const held = this.entities.get(key);
    // Strictly newer wins. A tombstone also wins an equal version (the removal is the later fact at that revision).
    if (held && (removed ? c.version < held.version : c.version <= held.version)) return "stale_ignored";
    if (this.dirty.has(key)) {
      this.pendingRemote.set(key, { version: c.version, removed, data });
      return "deferred_dirty";
    }
    this.upsert(key, c.version, removed, data);
    return "applied";
  }

  private upsert(key: string, version: number, removed: boolean, data: unknown): void {
    this.entities.set(key, { version, removed, data: removed ? null : data });
  }

  /** The device-state view for a charger, joined client-side so a status change never rewrites the tree. */
  deviceState(deviceId: string): DeviceStateView | null {
    return this.get<DeviceStateView>("device_state", deviceId);
  }
}
