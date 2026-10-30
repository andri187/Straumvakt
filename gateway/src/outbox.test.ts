import { describe, expect, it } from "vitest";
import { claim, closeAffectsDevice, standing, type EngineContext } from "./connection-ownership";
import { Outbox, OUTBOX_LIMITS, type OutboxEntry, type StoragePort } from "./outbox";

function memStorage(): StoragePort & { dump(): Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return m.get(k) as T | undefined;
    },
    async put<T>(k: string, v: T) {
      m.set(k, structuredClone(v));
    },
    async delete(k: string) {
      return m.delete(k);
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...m.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))) as Map<string, T>;
    },
    dump: () => m,
  };
}

const ctx = (placementId = "p1"): EngineContext => ({
  orgId: "o", installationId: "i", installationKey: "abcdefghijk1", chargePointId: "CP-1", identityString: "abcdefghijk1/CP-1",
  deviceId: "d", placementId, credentialMode: "none", credentialEpoch: "e",
});

describe("connection ownership", () => {
  it("each claim supersedes the last; an older socket is stale and its close changes nothing", () => {
    const a = claim(null, ctx());
    const b = claim(a.owner, ctx());
    expect(b.owner.generation).toBe(2);
    expect(standing(b.owner, a.tag)).toBe("stale");
    expect(standing(b.owner, b.tag)).toBe("current");
    expect(closeAffectsDevice(b.owner, a.tag, 1)).toBe(false); // stale socket closing
    expect(closeAffectsDevice(b.owner, b.tag, 0)).toBe(true);
    expect(closeAffectsDevice(b.owner, b.tag, 1)).toBe(false); // another current socket remains
  });
  it("a socket accepted under an old placement is stale after the device moves, even at the same generation", () => {
    const a = claim(null, ctx("p1"));
    const movedOwner = { ...a.owner, context: ctx("p2") };
    expect(standing(movedOwner, a.tag)).toBe("stale");
  });
  it("a socket with no tag or no owner is unowned, never trusted", () => {
    expect(standing(null, { generation: 1, placementId: "p" })).toBe("unowned");
    expect(standing(claim(null, ctx()).owner, null)).toBe("unowned");
  });
  it("generations survive reconstruction: a rebuilt owner continues the count", () => {
    const stored = JSON.parse(JSON.stringify(claim(claim(null, ctx()).owner, ctx()).owner));
    expect(claim(stored, ctx()).owner.generation).toBe(3);
  });
});

describe("outbox", () => {
  it("persists first, then settles: an ack deletes, a retry backs off, and a fresh instance sees the same entries", async () => {
    const s = memStorage();
    const o1 = new Outbox(s);
    await o1.enqueue("meter", '{"a":1}', 1000);
    await o1.enqueue("meter", '{"a":2}', 1000);
    const o2 = new Outbox(s); // hibernation wake-up: new object, same storage
    const due = await o2.due(1000);
    expect(due.map((e) => e.body)).toEqual(['{"a":1}', '{"a":2}']);
    await o2.settle([{ entry: due[0]!, verdict: "ack" }, { entry: due[1]!, verdict: "retry", error: "503" }], 1000);
    expect((await o2.stats()).live).toBe(1);
    expect(await o2.nextDueAt()).toBe(1000 + OUTBOX_LIMITS.BASE_BACKOFF_MS);
    expect(await o2.due(1000)).toEqual([]); // not due yet
    expect(await o2.due(1000 + OUTBOX_LIMITS.BASE_BACKOFF_MS)).toHaveLength(1);
  });
  it("backoff doubles and is capped", async () => {
    const o = new Outbox(memStorage());
    await o.enqueue("retry", "x", 0);
    let now = 0;
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      const [e] = await o.due(now);
      await o.settle([{ entry: e!, verdict: "retry" }], now);
      const nxt = (await o.nextDueAt())!;
      waits.push(nxt - now);
      now = nxt;
    }
    expect(waits.slice(0, 3)).toEqual([5000, 10000, 20000]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(OUTBOX_LIMITS.CAP_BACKOFF_MS);
  });
  it("is bounded: a full outbox rejects rather than drops, and oversized bodies are refused", async () => {
    const o = new Outbox(memStorage(), { ...OUTBOX_LIMITS, MAX_ENTRIES: 2 });
    expect(await o.enqueue("meter", "a", 0)).toMatchObject({ ok: true });
    expect(await o.enqueue("meter", "b", 0)).toMatchObject({ ok: true });
    expect(await o.enqueue("meter", "c", 0)).toEqual({ ok: false, reason: "full" });
    expect(await o.enqueue("meter", "x".repeat(OUTBOX_LIMITS.MAX_BODY_BYTES + 1), 0)).toEqual({ ok: false, reason: "too_large" });
    expect((await o.stats()).live).toBe(2); // nothing was evicted to make room
  });
  it("exhausted or poison entries are dead-lettered, kept, excluded from the alarm, and replayable", async () => {
    const o = new Outbox(memStorage(), { ...OUTBOX_LIMITS, MAX_ATTEMPTS: 2 });
    await o.enqueue("meter", "p", 0);
    await o.enqueue("meter", "q", 0);
    let [p, q] = await o.due(0) as [OutboxEntry, OutboxEntry];
    await o.settle([{ entry: p, verdict: "poison", error: "malformed" }, { entry: q, verdict: "retry" }], 0);
    q = (await o.due(OUTBOX_LIMITS.BASE_BACKOFF_MS))[0]!;
    await o.settle([{ entry: q, verdict: "retry" }], OUTBOX_LIMITS.BASE_BACKOFF_MS); // second attempt reaches MAX_ATTEMPTS
    expect(await o.stats()).toMatchObject({ live: 0, dead: 2 });
    expect(await o.nextDueAt()).toBeNull(); // no alarm for dead letters
    expect(await o.replayDead(99)).toBe(2);
    expect(await o.due(99)).toHaveLength(2);
  });
  it("entries older than the retention window are dead-lettered, not retried forever", async () => {
    const o = new Outbox(memStorage());
    await o.enqueue("meter", "old", 0);
    const [e] = await o.due(0);
    await o.settle([{ entry: e!, verdict: "retry" }], OUTBOX_LIMITS.MAX_AGE_MS);
    expect((await o.stats()).dead).toBe(1);
  });
  it("redelivery after a crash between send and ack is safe to repeat: the entry is still there until acked", async () => {
    const s = memStorage();
    const o = new Outbox(s);
    await o.enqueue("meter", "m", 0);
    await o.due(0); // sent to the engine, but the DO died before settle()
    const again = await new Outbox(s).due(0);
    expect(again).toHaveLength(1);
  });
});
