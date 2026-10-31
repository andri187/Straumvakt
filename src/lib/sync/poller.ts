// Visible-view refresh policy (Checkpoint D completion). Framework-free and
// clock-free: `step()` performs ONE round trip and returns how long to wait
// before the next, or `null` to stop. The UI owns the timer, so it can stop
// when the tab is hidden or the component unmounts; nothing here schedules
// itself, and nothing runs while nobody is looking.
//
// Cost rules encoded here (and counted in the handoff workload):
//   - first call: one snapshot (conditional if an ETag is held);
//   - then one `changes` per interval; an unchanged answer is tiny and, with the
//     hub, costs no database query;
//   - interval = BASE, stretching x2 after each UNCHANGED answer up to MAX, and
//     snapping back to BASE the moment something changes;
//   - a failure backs off x2 up to MAX_ERROR; 401/403 stops and clears state;
//   - `hasMore` and `reset_required` continue immediately (they are catch-up,
//     not polling) but bounded by MAX_CATCHUP_STEPS per cycle.

import type { SyncClient } from "./client";
import type { ChangesResponse, SnapshotResponse } from "./model";

export const POLL_BASE_MS = 30_000;
export const POLL_MAX_MS = 120_000;
export const POLL_MAX_ERROR_MS = 300_000;
export const MAX_CATCHUP_STEPS = 5;

export type SnapshotReply = { status: number; etag?: string | null; body?: SnapshotResponse; realtime?: boolean };
export type ChangesReply = { status: number; body?: ChangesResponse };
export interface Fetchers {
  snapshot(ifNoneMatch: string | null): Promise<SnapshotReply>;
  changes(cursor: string): Promise<ChangesReply>;
}

export type StepEvent = "snapshot" | "not_modified" | "changes" | "unchanged" | "reset" | "signed_out" | "error";

export class SyncPoller {
  private etag: string | null = null;
  private idle = 0;
  private errors = 0;
  private catchup = 0;

  constructor(
    private readonly client: SyncClient,
    private readonly fetchers: Fetchers,
  ) {}

  /** Returns { event, nextDelayMs } where nextDelayMs === null means "stop". */
  async step(): Promise<{ event: StepEvent; nextDelayMs: number | null }> {
    try {
      if (this.client.cursor === null) return await this.takeSnapshot();
      const r = await this.fetchers.changes(this.client.cursor);
      if (r.status === 401 || r.status === 403) return this.signedOut();
      if (r.status !== 200 || !r.body) return this.failed();
      this.errors = 0;
      const merged = this.client.applyChanges(r.body);
      if (merged === "reset") {
        // Scope changed or history unavailable: everything was evicted; refetch only what is still visible, now.
        this.etag = null;
        return this.cont("reset");
      }
      if (merged.hasMore) return this.cont("changes");
      this.catchup = 0;
      if (merged.merged.length > 0) {
        this.idle = 0;
        return { event: "changes", nextDelayMs: POLL_BASE_MS };
      }
      this.idle += 1;
      return { event: "unchanged", nextDelayMs: Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.min(this.idle, 2)) };
    } catch {
      return this.failed();
    }
  }

  private async takeSnapshot() {
    const r = await this.fetchers.snapshot(this.etag);
    if (r.status === 401 || r.status === 403) return this.signedOut();
    if (r.status === 304) {
      // We hold an ETag but no cursor (cannot normally happen); take an unconditional snapshot next.
      this.etag = null;
      return this.cont("not_modified");
    }
    if (r.status !== 200 || !r.body) return this.failed();
    this.errors = 0;
    this.client.applySnapshot(r.body);
    this.etag = r.etag ?? null;
    this.idle = 0;
    this.catchup = 0;
    return { event: "snapshot" as const, nextDelayMs: POLL_BASE_MS };
  }

  private cont(event: StepEvent): { event: StepEvent; nextDelayMs: number | null } {
    this.catchup += 1;
    // A bounded burst: past the limit, fall back to the normal interval instead of hammering.
    return { event, nextDelayMs: this.catchup >= MAX_CATCHUP_STEPS ? POLL_BASE_MS : 0 };
  }

  private failed(): { event: StepEvent; nextDelayMs: number | null } {
    this.errors += 1;
    return { event: "error", nextDelayMs: Math.min(POLL_MAX_ERROR_MS, POLL_BASE_MS * 2 ** this.errors) };
  }

  private signedOut(): { event: StepEvent; nextDelayMs: number | null } {
    this.client.clear();
    this.etag = null;
    return { event: "signed_out", nextDelayMs: null };
  }
}
