// Server-side admission for expensive reads and checks, shared across Worker isolates through the EXISTING VersionHub
// Durable Object. One primitive: a fixed window that admits at most `limit` takes per key. A check cooldown is
// limit = 1 per 30 s; a list/tree/incoming read limit is N per minute. No new service, no database write.
//
// WHY it is cheaper than the work it guards: one hub request (a small storage read and write) replaces a multi-query
// repository read on Neon. WHY it is not a module variable: an isolate-local counter lets every isolate admit its own
// burst; the hub is the one place all isolates agree.
//
// FAILURE: if the hub is unbound or unreachable the decision falls back to the isolate-local gate below, so a hub outage
// never blocks an authorized operator, and the bound degrades to "per isolate" instead of disappearing. The fallback is
// reported (`source`) so a measurement cannot mistake it for the distributed guarantee.
//
// KEYS are built by the caller from the permission partition (actor + permission scope) and the kind of read, so two
// actors with different access never share a window or a remembered answer.

export type GateDecision = {
  allow: boolean;
  /** Time until the current window ends (when denied: until a take is possible again). */
  retryAfterMs: number;
  /** Milliseconds since the window that admitted the most recent take began. */
  ageMs: number;
  /** Value stored with `record` for the window (e.g. the revisions a check learned). Only ever returned to a denied taker. */
  data?: unknown;
  source: "hub" | "isolate";
};

export interface Gate {
  take(key: string, windowMs: number, limit: number): Promise<GateDecision>;
  /** Attach the result of the admitted work to its window, so a denied taker can be answered without repeating it. */
  record(key: string, data: unknown): Promise<void>;
}

type Entry = { w: number; n: number; data?: unknown };
export const MAX_GATE_KEYS = 64;
/** Stored answers are small by construction (a revision per installation, at most 51). */
export const MAX_GATE_DATA_BYTES = 4096;

/** The decision rule, shared verbatim by the isolate gate and the hub so the two cannot drift. */
export function decide(cur: Entry | undefined, now: number, windowMs: number, limit: number): { entry: Entry; decision: Omit<GateDecision, "source"> } {
  if (cur && now >= cur.w && now - cur.w < windowMs) {
    const retryAfterMs = windowMs - (now - cur.w);
    if (cur.n >= limit) return { entry: cur, decision: { allow: false, retryAfterMs, ageMs: now - cur.w, data: cur.data } };
    return { entry: { ...cur, n: cur.n + 1 }, decision: { allow: true, retryAfterMs, ageMs: now - cur.w } };
  }
  return { entry: { w: now, n: 1 }, decision: { allow: true, retryAfterMs: windowMs, ageMs: 0 } };
}

export class LocalGate implements Gate {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  async take(key: string, windowMs: number, limit: number): Promise<GateDecision> {
    const { entry, decision } = decide(this.entries.get(key), this.now(), windowMs, limit);
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > MAX_GATE_KEYS) this.entries.delete(this.entries.keys().next().value as string);
    return { ...decision, source: "isolate" };
  }

  async record(key: string, data: unknown): Promise<void> {
    const e = this.entries.get(key);
    if (e && JSON.stringify(data).length <= MAX_GATE_DATA_BYTES) this.entries.set(key, { ...e, data });
  }

  get size(): number {
    return this.entries.size;
  }
}

/** What the hub client offers; kept structural so this module does not import hub.ts. */
export type GateHub = {
  gate?(key: string, windowMs: number, limit: number): Promise<Omit<GateDecision, "source">>;
  gateRecord?(key: string, data: unknown): Promise<void>;
};

/** Hub first; the isolate gate when there is no hub or it fails. A hub answer is authoritative for every isolate. */
export function hubBackedGate(hub: GateHub | null | undefined, fallback: Gate): Gate {
  if (!hub?.gate) return fallback;
  return {
    async take(key, windowMs, limit) {
      try {
        return { ...(await hub.gate!(key, windowMs, limit)), source: "hub" };
      } catch {
        return fallback.take(key, windowMs, limit);
      }
    },
    async record(key, data) {
      try {
        await hub.gateRecord?.(key, data);
      } catch {
        await fallback.record(key, data);
      }
    },
  };
}

/** The process-wide fallback, one per isolate. */
export const isolateGate = new LocalGate();

/** Read-limit policy (per permission partition). Starting values: generous for a person, small for a script. */
export const READ_LIMITS = {
  /** Installations list, chargers list. */
  list: { windowMs: 60_000, limit: 12 },
  /** One expanded installation. */
  tree: { windowMs: 60_000, limit: 40 },
  /** The editor's full read (history, routing). */
  detail: { windowMs: 60_000, limit: 40 },
  /** Incoming discovery (database + gateway presence RPC). */
  incoming: { windowMs: 60_000, limit: 12 },
} as const;
export type ReadKind = keyof typeof READ_LIMITS;
