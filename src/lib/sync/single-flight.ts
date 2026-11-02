// One in-flight load per key. Concurrent callers for the same key share the same promise (and so the same database
// connection and queries); once it settles the entry is dropped, so nothing is cached and nothing can go stale here.
// Durable reuse of results is a separate decision (see check.ts); this only removes duplicate simultaneous work.

export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();
  /** For measurement: loads actually started vs callers that joined a load already running. */
  readonly stats = { started: 0, joined: 0 };

  run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const held = this.inflight.get(key) as Promise<T> | undefined;
    if (held) {
      this.stats.joined += 1;
      return held;
    }
    this.stats.started += 1;
    const p: Promise<T> = Promise.resolve()
      .then(load)
      .finally(() => {
        if (this.inflight.get(key) === p) this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  get size(): number {
    return this.inflight.size;
  }
}

/** The process-wide instance used by the installations handlers. */
export const isolateFlight = new SingleFlight();
