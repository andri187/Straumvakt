/**
 * Durable, bounded record of RemoteStopTransaction attempts for the per-device Durable Object.
 *
 * WHY: a stop command used to be correlated only in memory (a Map of waiters). A crash, eviction or retried request
 * between "sent" and "answered" lost every trace of the attempt, and a retried caller could put a second command on the
 * wire. The lifecycle service now reserves a stable ATTEMPT id before it asks; this module keeps one small record per
 * attempt in Durable Object storage so that:
 *   - the intent is persisted BEFORE the frame is sent;
 *   - a repeated delivery of the same attempt never sends again (it gets the retained outcome, or an honest "timeout"
 *     while the attempt is still undecided);
 *   - a crash after the intent leaves a record that can only end as "timeout" (the command may or may not have reached
 *     the charger: uncertain, never guessed, never replayed);
 *   - a reply counts only for the socket generation that carried the command, and only before the attempt expired.
 *
 * WHAT IT IS NOT: confirmation of a stop. `accepted` means the charger said it will try; the session is stopped only by
 * the durable StopTransaction the engine records. Nothing here reads or writes the engine.
 *
 * BOUNDS: at most MAX_STOP_RECORDS records per device. An unresolved record is NEVER evicted to make room; admission is
 * refused instead (back-pressure). Resolved records are kept until their attempt deadline has passed (a replay can no
 * longer send) and STOP_TERMINAL_RETENTION_MS after they resolved, then removed lazily on the next admission; no timer
 * exists for retention. Pending records arm exactly one alarm each, at their expiry, so an empty set arms nothing.
 *
 * Expected storage writes per attempted command (no measured figure, structural count only): 1 put for the intent,
 * 1 put for the resolution, 1 alarm set; plus a delete per record purged later. A refused or offline command writes
 * nothing.
 */
import type { StoragePort } from "./outbox";

export type StopCommandOutcome = "accepted" | "rejected" | "offline" | "timeout" | "unavailable";
export type StopCommandResult = { outcome: StopCommandOutcome; reason?: string };
export type StopCommandInput = { transactionNo: number; attemptId: string; requestId: string; placementId: string; deadlineMs: number };
export type StopVia = "response" | "deadline" | "disconnected" | "send_failed";

export type StopRecord = {
  attemptId: string;
  requestId: string;
  placementId: string;
  transactionNo: number;
  /** Socket generation the frame was sent on. A reply from any other generation never completes this attempt. */
  generation: number;
  /** The OCPP unique id on the wire. */
  uniqueId: string;
  createdAt: number;
  /** The caller's attempt deadline: after this, a delivery that finds no record is refused rather than sent. */
  deadlineMs: number;
  /** When an unanswered command is declared "timeout" (<= deadlineMs). The alarm is armed for this. */
  expiresAt: number;
  phase: "pending" | "done";
  outcome?: StopCommandOutcome;
  via?: StopVia;
  resolvedAt?: number;
};

export const MAX_STOP_RECORDS = 16;
export const STOP_TERMINAL_RETENTION_MS = 60 * 60_000;
/** A caller deadline further ahead than this is refused: attempt windows are short by design. */
export const MAX_STOP_DEADLINE_AHEAD_MS = 10 * 60_000;
export const MAX_TRANSACTION_NO = 2_147_483_647;

const PREFIX = "stopcmd:";
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;
const key = (attemptId: string) => `${PREFIX}${attemptId}`;

/** Returns a short reason when the input is not a well-formed stop request, otherwise null. Pure. */
export function validateStopInput(input: unknown, nowMs: number): string | null {
  if (!input || typeof input !== "object") return "bad_request";
  const i = input as Record<string, unknown>;
  if (typeof i.transactionNo !== "number" || !Number.isInteger(i.transactionNo) || i.transactionNo < 1 || i.transactionNo > MAX_TRANSACTION_NO) return "bad_transaction";
  if (typeof i.attemptId !== "string" || !ID.test(i.attemptId)) return "bad_attempt";
  if (typeof i.requestId !== "string" || !ID.test(i.requestId)) return "bad_request_id";
  if (typeof i.placementId !== "string" || !ID.test(i.placementId)) return "bad_placement";
  if (typeof i.deadlineMs !== "number" || !Number.isFinite(i.deadlineMs)) return "bad_deadline";
  if (i.deadlineMs > nowMs + MAX_STOP_DEADLINE_AHEAD_MS) return "bad_deadline";
  return null;
}

export class StopCommandStore {
  constructor(
    private readonly storage: StoragePort,
    private readonly max: number = MAX_STOP_RECORDS,
    private readonly retentionMs: number = STOP_TERMINAL_RETENTION_MS,
  ) {}

  get(attemptId: string): Promise<StopRecord | undefined> {
    return this.storage.get<StopRecord>(key(attemptId));
  }

  private async all(): Promise<StopRecord[]> {
    return [...(await this.storage.list<StopRecord>({ prefix: PREFIX, limit: this.max + 8 })).values()];
  }

  async findByUniqueId(uniqueId: string): Promise<StopRecord | undefined> {
    return (await this.all()).find((r) => r.uniqueId === uniqueId);
  }

  /**
   * Persists the intent of a NEW attempt. Resolved records that can no longer matter are purged first; an unresolved record
   * is never evicted. "capacity" means the caller must refuse the command (back-pressure), not send it unrecorded.
   */
  async admit(rec: StopRecord, nowMs: number): Promise<"ok" | "capacity"> {
    const all = await this.all();
    let live = all.length;
    const settled = (r: StopRecord) => r.phase === "done" && nowMs >= r.deadlineMs;
    for (const r of all) {
      if (settled(r) && nowMs - (r.resolvedAt ?? 0) >= this.retentionMs) {
        await this.storage.delete(key(r.attemptId));
        live--;
      }
    }
    if (live >= this.max) {
      // Still full: drop the oldest resolved records that can no longer be replayed. Never an unresolved one.
      const evictable = all.filter((r) => settled(r) && nowMs - (r.resolvedAt ?? 0) < this.retentionMs).sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
      for (const r of evictable) {
        if (live < this.max) break;
        await this.storage.delete(key(r.attemptId));
        live--;
      }
    }
    if (live >= this.max) return "capacity";
    await this.storage.put(key(rec.attemptId), rec);
    return "ok";
  }

  /** Idempotent: an already-resolved record is returned unchanged (first resolution wins). */
  async resolve(attemptId: string, outcome: StopCommandOutcome, via: StopVia, nowMs: number): Promise<StopRecord | null> {
    const rec = await this.get(attemptId);
    if (!rec) return null;
    if (rec.phase === "done") return rec;
    const next: StopRecord = { ...rec, phase: "done", outcome, via, resolvedAt: nowMs };
    await this.storage.put(key(attemptId), next);
    return next;
  }

  /** Resolves every pending record whose expiry has passed as "timeout" (uncertain). Returns what it resolved. */
  async expireDue(nowMs: number): Promise<StopRecord[]> {
    const out: StopRecord[] = [];
    for (const r of await this.all()) {
      if (r.phase === "pending" && r.expiresAt <= nowMs) {
        const done = await this.resolve(r.attemptId, "timeout", "deadline", nowMs);
        if (done) out.push(done);
      }
    }
    return out;
  }

  /** Earliest expiry among unresolved records, or null (then no alarm is needed for commands). */
  async nextExpiry(): Promise<number | null> {
    let min: number | null = null;
    for (const r of await this.all()) if (r.phase === "pending" && (min === null || r.expiresAt < min)) min = r.expiresAt;
    return min;
  }

  /** The socket generation that carried these commands is gone: they can never be answered. Uncertain, so "timeout". */
  async abandonGeneration(generation: number, nowMs: number): Promise<StopRecord[]> {
    const out: StopRecord[] = [];
    for (const r of await this.all()) {
      if (r.phase === "pending" && r.generation === generation) {
        const done = await this.resolve(r.attemptId, "timeout", "disconnected", nowMs);
        if (done) out.push(done);
      }
    }
    return out;
  }
}
