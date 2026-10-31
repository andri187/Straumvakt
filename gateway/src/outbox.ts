/**
 * Bounded durable outbox in Durable Object storage (Checkpoint B).
 *
 * Purpose: when the engine (or the network to it) is unavailable, a frame that
 * the charger has already been answered for — or that is deliberately batched —
 * is NOT lost. It is written to DO storage first, retried with capped backoff,
 * and only deleted after the engine acknowledges it. A DO restart or hibernation
 * wake-up sees the same entries.
 *
 * Guarantees (and their limits):
 *   • Acknowledgment point: an entry is deleted only on an `ack` from the engine
 *     (which itself acks only after its database commit).
 *   • Bounded: at most MAX_ENTRIES entries and MAX_BYTES of body. A full outbox
 *     REJECTS the enqueue; the caller must turn that into a CALLERROR so the
 *     charger keeps the data. Nothing is dropped silently to make room.
 *   • Bounded retry: exponential backoff (BASE .. CAP), at most MAX_ATTEMPTS and
 *     MAX_AGE_MS; after that the entry moves to the dead-letter set (still
 *     stored, still counted, replayable) instead of being discarded.
 *   • Not exactly-once: delivery is at-least-once; the engine's idempotent
 *     writes make a redelivery a no-op.
 *   • Single DO instance = single writer, so no cross-instance races. Ordering
 *     is by enqueue sequence; the engine converges regardless of order.
 */

export interface StoragePort {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string; limit?: number }): Promise<Map<string, T>>;
}

export type OutboxKind = "meter" | "status" | "retry";

export type OutboxEntry = {
  seq: number;
  kind: OutboxKind;
  /** Serialised engine call. Opaque to the outbox. */
  body: string;
  attempts: number;
  enqueuedAt: number;
  nextAt: number;
  dead?: boolean;
  lastError?: string;
  retryStartedAt?: number;
  replayCount?: number;
  lastReplay?: { requestId: string; actor: string; at: number };
};

export type OutboxLimits = {
  MAX_ENTRIES: number; MAX_BYTES: number; MAX_BODY_BYTES: number; BATCH: number;
  BASE_BACKOFF_MS: number; CAP_BACKOFF_MS: number; MAX_ATTEMPTS: number; MAX_AGE_MS: number;
};

export const OUTBOX_LIMITS: OutboxLimits = {
  MAX_ENTRIES: 500,
  MAX_BYTES: 256 * 1024,
  MAX_BODY_BYTES: 16 * 1024,
  BATCH: 20,
  BASE_BACKOFF_MS: 5_000,
  CAP_BACKOFF_MS: 15 * 60_000,
  MAX_ATTEMPTS: 12,
  MAX_AGE_MS: 24 * 60 * 60_000,
};

const META = "obmeta";
const P = "ob:";
type Meta = { nextSeq: number; count: number; bytes: number };
const key = (seq: number) => `${P}${String(seq).padStart(12, "0")}`;
const enc = new TextEncoder();

export type EnqueueResult = { ok: true; seq: number } | { ok: false; reason: "full" | "too_large" };
export type DeliveryVerdict = "ack" | "retry" | "poison";

export class Outbox {
  constructor(
    private readonly storage: StoragePort,
    private readonly limits: OutboxLimits = OUTBOX_LIMITS,
  ) {}

  private async meta(): Promise<Meta> {
    return (await this.storage.get<Meta>(META)) ?? { nextSeq: 1, count: 0, bytes: 0 };
  }

  async enqueue(kind: OutboxKind, body: string, now: number, nextAt = now): Promise<EnqueueResult> {
    const size = enc.encode(body).length;
    if (size > this.limits.MAX_BODY_BYTES) return { ok: false, reason: "too_large" };
    const m = await this.meta();
    if (m.count >= this.limits.MAX_ENTRIES || m.bytes + size > this.limits.MAX_BYTES) return { ok: false, reason: "full" };
    const entry: OutboxEntry = { seq: m.nextSeq, kind, body, attempts: 0, enqueuedAt: now, nextAt };
    await this.storage.put(key(entry.seq), entry);
    await this.storage.put(META, { nextSeq: m.nextSeq + 1, count: m.count + 1, bytes: m.bytes + size } satisfies Meta);
    return { ok: true, seq: entry.seq };
  }

  /** Live (non-dead) entries due now, oldest first, at most BATCH. */
  async due(now: number): Promise<OutboxEntry[]> {
    const all = await this.storage.list<OutboxEntry>({ prefix: P });
    return [...all.values()].filter((e) => !e.dead && e.nextAt <= now).slice(0, this.limits.BATCH);
  }

  /** Earliest time any live entry becomes due, or null. Used to arm ONE alarm, never a poll. */
  async nextDueAt(): Promise<number | null> {
    const all = await this.storage.list<OutboxEntry>({ prefix: P });
    let min: number | null = null;
    for (const e of all.values()) if (!e.dead && (min === null || e.nextAt < min)) min = e.nextAt;
    return min;
  }

  async stats(): Promise<{ live: number; dead: number; bytes: number }> {
    const all = await this.storage.list<OutboxEntry>({ prefix: P });
    let live = 0;
    let dead = 0;
    for (const e of all.values()) e.dead ? dead++ : live++;
    return { live, dead, bytes: (await this.meta()).bytes };
  }

  /**
   * Apply the engine's per-entry verdicts. `ack` deletes. `retry` backs off, and
   * past the attempt/age bound becomes dead-lettered. `poison` (a frame the
   * engine will never accept, e.g. malformed) is dead-lettered at once with its
   * evidence retained.
   */
  async settle(results: { entry: OutboxEntry; verdict: DeliveryVerdict; error?: string }[], now: number): Promise<void> {
    const m = await this.meta();
    for (const { entry, verdict, error } of results) {
      if (verdict === "ack") {
        await this.storage.delete(key(entry.seq));
        m.count = Math.max(0, m.count - 1);
        m.bytes = Math.max(0, m.bytes - enc.encode(entry.body).length);
        continue;
      }
      const attempts = entry.attempts + 1;
      const exhausted = verdict === "poison" || attempts >= this.limits.MAX_ATTEMPTS || now - (entry.retryStartedAt ?? entry.enqueuedAt) >= this.limits.MAX_AGE_MS;
      const next: OutboxEntry = exhausted
        ? { ...entry, attempts, dead: true, lastError: error ?? verdict }
        : { ...entry, attempts, nextAt: now + Math.min(this.limits.CAP_BACKOFF_MS, this.limits.BASE_BACKOFF_MS * 2 ** (attempts - 1)), lastError: error };
      await this.storage.put(key(entry.seq), next);
    }
    await this.storage.put(META, m);
  }

  /** Metadata only. Original charger payload never leaves the repair surface. */
  async inspect(after = 0): Promise<{ entries: Omit<OutboxEntry, "body">[]; hasMore: boolean }> {
    const all = [...(await this.storage.list<OutboxEntry>({ prefix: P })).values()].filter(e => e.seq > after);
    return { entries: all.slice(0, this.limits.BATCH).map(({ body: _body, ...metadata }) => metadata), hasMore: all.length > this.limits.BATCH };
  }

  /** Selected IDs only, one bounded retry round. Keep original evidence age/body and the latest explicit replay audit. */
  async replayDead(now: number, selected: number[], audit: { requestId: string; actor: string }): Promise<number> {
    if (selected.length < 1 || selected.length > this.limits.BATCH || selected.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error("invalid replay selection");
    let n = 0;
    for (const seq of new Set(selected)) {
      const e = await this.storage.get<OutboxEntry>(key(seq));
      if (!e?.dead || e.lastReplay?.requestId === audit.requestId) continue;
      await this.storage.put(key(e.seq), { ...e, dead: false, attempts: 0, nextAt: now, retryStartedAt: now, replayCount: (e.replayCount ?? 0) + 1, lastReplay: { ...audit, at: now } });
      n++;
    }
    return n;
  }
}
