// Server-side read-model cache for installation STRUCTURE (Checkpoint D).
//
// MECHANISM, stated plainly: a bounded, per-isolate (process-local) map. On its
// own that would be unsafe across isolates, so correctness never rests on it:
//
//   1. An entry is keyed by (projection, installation) and stamped with the
//      structure `revision` it was built from.
//   2. Before serving, the caller learns the CURRENT revision from a cheap
//      version probe (one indexed read of two integers) and the entry is used
//      only if the revisions are equal. A stale entry is therefore never served
//      as current, in any isolate, regardless of TTL or lost invalidations.
//   3. `trustForMs` (default 0 = always probe) may skip the probe for entries
//      validated that recently. That is the ONLY source of staleness, it is
//      bounded by that number, and it is the caller's explicit choice.
//   4. A save invalidates the entry in its own isolate immediately; every other
//      isolate converges by (2). The change feed also evicts entries whose
//      revision it sees overtaken. A lost invalidation costs one extra query.
//
// Nothing here stores secrets, verifiers or permission decisions: only the
// projected structure that an authorised caller was already entitled to read,
// under a key that includes the projection so an admin payload is never served
// to another projection.

import type { Projection, Structure } from "./model";

type Entry = { revision: number; value: Structure; builtAt: number; validatedAt: number };

export class StructureCache {
  private readonly map = new Map<string, Entry>();
  constructor(
    private readonly maxEntries = 200,
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private key(p: Projection, installationId: string): string {
    return `${p}|${installationId}`;
  }

  /** Serve only if the revision matches the probe, or the entry was validated within `trustForMs`. */
  get(p: Projection, installationId: string, currentRevision: number | null, trustForMs = 0): Structure | null {
    const k = this.key(p, installationId);
    const e = this.map.get(k);
    if (!e) return null;
    const t = this.now();
    if (t - e.builtAt > this.ttlMs) {
      this.map.delete(k);
      return null;
    }
    if (currentRevision === null) {
      // No probe available: only a recently-validated entry may be served.
      return t - e.validatedAt <= trustForMs ? this.touch(k, e) : null;
    }
    if (e.revision !== currentRevision) {
      this.map.delete(k);
      return null;
    }
    e.validatedAt = t;
    return this.touch(k, e);
  }

  put(p: Projection, installationId: string, value: Structure): void {
    const k = this.key(p, installationId);
    this.map.delete(k);
    const t = this.now();
    this.map.set(k, { revision: value.installation.revision, value, builtAt: t, validatedAt: t });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string);
  }

  invalidate(installationId: string): void {
    for (const k of [...this.map.keys()]) if (k.endsWith(`|${installationId}`)) this.map.delete(k);
  }

  /** Evict any entry for this installation older than `revision` (the feed saw it overtaken). */
  evictBelow(installationId: string, revision: number): void {
    for (const [k, e] of this.map) if (k.endsWith(`|${installationId}`) && e.revision < revision) this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  private touch(k: string, e: Entry): Structure {
    this.map.delete(k); // LRU: re-insert at the end
    this.map.set(k, e);
    return e.value;
  }
}
