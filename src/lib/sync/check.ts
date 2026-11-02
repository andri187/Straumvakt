// Structural revision check with a server-enforced cooldown (GET /api/cpo/sync?check=1).
//
// WHAT IT ANSWERS: the current structure revision of every installation the actor may see, and when that was learned. The
// client compares it with the revisions its cached lists were built from; a difference is "Updates available". The server
// never says "unchanged" - that is the client's conclusion from the numbers, so a stale answer cannot assert something false.
//
// COST RULES (all enforced here, before any probe is attempted):
//   - authorization still ran: the caller resolved effective access to get the ids; nothing below grants anything;
//   - per (permission scope, actor, visible set): at most one probe per cooldown. Inside the window the last known
//     revisions come back with `deferred: true`, `checkedAt` and `retryAfterMs`, and NO probe runs;
//   - concurrent probes for the same visible set share one load (single flight), so K viewers cost one probe, and with a
//     fresh VersionHub that probe is a Durable Object read, not a Neon query;
//   - a commit in this isolate updates the remembered answers immediately (noteCommit), so a deferred answer never hides a
//     local write. A commit made by another isolate is seen at the next accepted check, at most one cooldown later, and
//     `checkedAt` tells the client exactly how old the answer is.
//
// Two layers, both holding only integers and a timestamp (nothing secret):
//   - this isolate remembers its own answers (no network at all inside the window);
//   - when a Gate is supplied (the VersionHub Durable Object, see gate.ts) the cooldown is shared by EVERY isolate: an actor
//     whose check was admitted anywhere is answered from the remembered revisions everywhere, so N isolates cannot each
//     admit their own check. Without a hub the bound is per isolate, and the gate reports that (`source: "isolate"`).

import type { Gate } from "./gate";
import { SingleFlight } from "./single-flight";
import { SYNC_SCHEMA, scopeHash, MAX_SCOPE_INSTALLATIONS, type CheckResponse } from "./model";
import type { SyncDeps } from "./service";

export const CHECK_COOLDOWN_MS = 30_000;
const PROJECTION = "cpo-admin" as const;

type Known = { at: number; scope: string; revisions: Record<string, number> };

export class ScopeChecker {
  private readonly known = new Map<string, Known>();
  private readonly flight = new SingleFlight();
  /** For measurement. */
  readonly stats = { accepted: 0, deferred: 0 };

  constructor(
    private readonly now: () => number = Date.now,
    private readonly cooldownMs = CHECK_COOLDOWN_MS,
    private readonly maxEntries = 500,
  ) {}

  async check(partition: string, scope: string, probe: () => Promise<Record<string, number>>, gate?: Gate): Promise<CheckResponse> {
    const key = `${partition}|${scope}`;
    const t = this.now();
    const prev = this.known.get(key);
    if (prev && t - prev.at >= 0 && t - prev.at < this.cooldownMs) {
      this.stats.deferred += 1;
      return { schema: SYNC_SCHEMA, scope, revisions: { ...prev.revisions }, checkedAt: prev.at, ageMs: t - prev.at, deferred: true, retryAfterMs: this.cooldownMs - (t - prev.at) };
    }
    const gateKey = `check|${key}`;
    if (gate) {
      const d = await gate.take(gateKey, this.cooldownMs, 1);
      if (!d.allow) {
        // Admitted elsewhere inside the window. Answer from what that check learned (kept current by commits); only when
        // nothing was recorded yet (its probe is still running) does this isolate look for itself, once.
        const data = d.data as { revisions?: Record<string, number> } | undefined;
        const revisions = data?.revisions ?? prev?.revisions ?? (await this.flight.run(`probe|${scope}`, probe));
        const at = t - d.ageMs;
        this.stats.deferred += 1;
        this.remember(key, { at, scope, revisions: { ...revisions } });
        return { schema: SYNC_SCHEMA, scope, revisions: { ...revisions }, checkedAt: at, ageMs: d.ageMs, deferred: true, retryAfterMs: d.retryAfterMs };
      }
    }
    // The probe is shared across actors with the same visible set; the cooldown above is still per actor.
    const revisions = await this.flight.run(`probe|${scope}`, probe);
    this.stats.accepted += 1;
    this.remember(key, { at: t, scope, revisions: { ...revisions } });
    if (gate) await gate.record(gateKey, { at: t, revisions }).catch(() => undefined); // only helps other isolates; never fails the check
    return { schema: SYNC_SCHEMA, scope, revisions, checkedAt: t, ageMs: 0, deferred: false, retryAfterMs: this.cooldownMs };
  }

  private remember(key: string, k: Known): void {
    this.known.delete(key);
    this.known.set(key, k);
    while (this.known.size > this.maxEntries) this.known.delete(this.known.keys().next().value as string);
  }

  /** A structure save committed in this isolate: fold it into every remembered answer so none can hide it. */
  noteCommit(installationId: string, revision: number): void {
    for (const k of this.known.values()) k.revisions[installationId] = Math.max(k.revisions[installationId] ?? 0, revision);
  }

  /** Forget everything remembered (logout/revocation callers, tests). The next check probes. */
  clear(): void {
    this.known.clear();
  }

  get size(): number {
    return this.known.size;
  }
}

/** The process-wide instance: one per isolate, shared by the check endpoint and the writers that must update it. */
export const isolateChecker = new ScopeChecker();

export type CheckResult = { kind: "check"; body: CheckResponse } | { kind: "forbidden" } | { kind: "too_many" };

export async function readCheck<Actor>(deps: SyncDeps<Actor>, actor: Actor, checker: ScopeChecker, partition: string, gate?: Gate): Promise<CheckResult> {
  const vis = await deps.access.visible(actor);
  if (!vis) return { kind: "forbidden" };
  const ids = [...new Set(vis.installationIds)].sort();
  if (ids.length > MAX_SCOPE_INSTALLATIONS) return { kind: "too_many" };
  const scope = await scopeHash(PROJECTION, ids);
  const body = await checker.check(partition, scope, async () => {
    const versions = ids.length ? await deps.repo.versions(ids) : new Map();
    return Object.fromEntries([...versions].map(([id, v]) => [id, v.revision]));
  }, gate);
  return { kind: "check", body };
}
