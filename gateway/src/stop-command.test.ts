import { describe, expect, it } from "vitest";
import type { StoragePort } from "./outbox";
import { MAX_STOP_DEADLINE_AHEAD_MS, MAX_STOP_RECORDS, StopCommandStore, STOP_TERMINAL_RETENTION_MS, validateStopInput, type StopRecord } from "./stop-command";

class MapStorage implements StoragePort {
  m = new Map<string, unknown>();
  puts = 0;
  async get<T>(k: string) { const v = this.m.get(k); return v === undefined ? undefined : (structuredClone(v) as T); }
  async put<T>(k: string, v: T) { this.puts++; this.m.set(k, structuredClone(v)); }
  async delete(k: string) { return this.m.delete(k); }
  async list<T>(o: { prefix: string; limit?: number }) {
    const rows = [...this.m.entries()].filter(([k]) => k.startsWith(o.prefix)).sort(([a], [b]) => a.localeCompare(b));
    return new Map(rows.slice(0, o.limit ?? rows.length).map(([k, v]) => [k, structuredClone(v)])) as Map<string, T>;
  }
}

const NOW = 5_000_000;
const rec = (over: Partial<StopRecord> = {}): StopRecord => ({
  attemptId: "a:1:1", requestId: "a", placementId: "p1", transactionNo: 1, generation: 1, uniqueId: "u1", createdAt: NOW, deadlineMs: NOW + 60_000, expiresAt: NOW + 10_000, phase: "pending", ...over,
});
const input = (over: Record<string, unknown> = {}) => ({ transactionNo: 7, attemptId: "r:7:1", requestId: "r", placementId: "p1", deadlineMs: NOW + 60_000, ...over });

describe("validateStopInput", () => {
  it("accepts a well-formed attempt and returns a short reason for each malformed field", () => {
    expect(validateStopInput(input(), NOW)).toBeNull();
    const cases: [Record<string, unknown>, string][] = [
      [{ transactionNo: 0 }, "bad_transaction"], [{ transactionNo: 2_147_483_648 }, "bad_transaction"], [{ transactionNo: 1.5 }, "bad_transaction"], [{ transactionNo: "7" }, "bad_transaction"],
      [{ attemptId: "" }, "bad_attempt"], [{ attemptId: "x".repeat(97) }, "bad_attempt"], [{ attemptId: "a b" }, "bad_attempt"],
      [{ requestId: undefined }, "bad_request_id"], [{ placementId: "a/b" }, "bad_placement"],
      [{ deadlineMs: Number.POSITIVE_INFINITY }, "bad_deadline"], [{ deadlineMs: NOW + MAX_STOP_DEADLINE_AHEAD_MS + 1 }, "bad_deadline"],
    ];
    for (const [over, reason] of cases) expect(validateStopInput(input(over), NOW), JSON.stringify(over)).toBe(reason);
    expect(validateStopInput(null, NOW)).toBe("bad_request");
    expect(validateStopInput("x", NOW)).toBe("bad_request");
  });
  it("a deadline already in the past is well-formed (it is refused as expired by the device, not as malformed)", () => {
    expect(validateStopInput(input({ deadlineMs: NOW - 1 }), NOW)).toBeNull();
  });
});

describe("StopCommandStore", () => {
  it("admits one record per attempt with one write, and resolves it idempotently (first resolution wins)", async () => {
    const s = new MapStorage();
    const store = new StopCommandStore(s);
    expect(await store.admit(rec(), NOW)).toBe("ok");
    expect(s.puts).toBe(1);
    const first = await store.resolve("a:1:1", "accepted", "response", NOW + 1);
    const second = await store.resolve("a:1:1", "timeout", "deadline", NOW + 2);
    expect(first).toMatchObject({ phase: "done", outcome: "accepted", via: "response", resolvedAt: NOW + 1 });
    expect(second).toEqual(first);
    expect(s.puts).toBe(2); // the second resolution wrote nothing
    expect(await store.resolve("missing", "timeout", "deadline", NOW)).toBeNull();
  });
  it("never evicts an unresolved record: a full set of pending attempts refuses the next one", async () => {
    const store = new StopCommandStore(new MapStorage());
    for (let i = 0; i < MAX_STOP_RECORDS; i++) expect(await store.admit(rec({ attemptId: `a:${i}:1`, uniqueId: `u${i}`, deadlineMs: NOW - 1 }), NOW)).toBe("ok");
    expect(await store.admit(rec({ attemptId: "late", uniqueId: "ul" }), NOW)).toBe("capacity");
    expect(await store.get("a:0:1")).toBeDefined();
  });
  it("purges resolved records only after their attempt deadline AND the retention; under pressure it drops the oldest replay-proof resolved ones", async () => {
    const s = new MapStorage();
    const store = new StopCommandStore(s, 2);
    await store.admit(rec({ attemptId: "old", uniqueId: "u-old", deadlineMs: NOW + 1_000 }), NOW);
    await store.admit(rec({ attemptId: "mid", uniqueId: "u-mid", deadlineMs: NOW + 1_000 }), NOW);
    await store.resolve("old", "accepted", "response", NOW + 10);
    await store.resolve("mid", "rejected", "response", NOW + 20);
    // before the deadline a resolved record is still the replay guard: nothing may be dropped, so the set is full
    expect(await store.admit(rec({ attemptId: "n1", uniqueId: "u-n1" }), NOW + 500)).toBe("capacity");
    // after the deadline a replay can no longer send, so pressure may drop the OLDEST resolved record (retention not yet over)
    expect(await store.admit(rec({ attemptId: "n1", uniqueId: "u-n1" }), NOW + 2_000)).toBe("ok");
    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("mid")).toBeDefined();
    // once the retention is over the remaining one is purged without any pressure
    await store.resolve("n1", "accepted", "response", NOW + 2_001);
    expect(await store.admit(rec({ attemptId: "n2", uniqueId: "u-n2" }), NOW + 2_000 + STOP_TERMINAL_RETENTION_MS)).toBe("ok");
    expect(await store.get("mid")).toBeUndefined();
  });
  it("expireDue resolves only pending records whose expiry passed, as uncertain 'timeout'; nextExpiry sees only pending ones", async () => {
    const store = new StopCommandStore(new MapStorage());
    await store.admit(rec({ attemptId: "soon", uniqueId: "u1", expiresAt: NOW + 5 }), NOW);
    await store.admit(rec({ attemptId: "later", uniqueId: "u2", expiresAt: NOW + 50 }), NOW);
    await store.admit(rec({ attemptId: "done", uniqueId: "u3", expiresAt: NOW + 1 }), NOW);
    await store.resolve("done", "accepted", "response", NOW);
    expect(await store.nextExpiry()).toBe(NOW + 5);
    const expired = await store.expireDue(NOW + 5);
    expect(expired.map((r) => r.attemptId)).toEqual(["soon"]);
    expect(expired[0]).toMatchObject({ outcome: "timeout", via: "deadline" });
    expect(await store.nextExpiry()).toBe(NOW + 50);
    expect((await store.get("done"))!.outcome).toBe("accepted"); // a decided attempt is never rewritten
    await store.expireDue(NOW + 50);
    expect(await store.nextExpiry()).toBeNull(); // nothing pending => no alarm needed
  });
  it("abandonGeneration resolves only the commands carried by that generation", async () => {
    const store = new StopCommandStore(new MapStorage());
    await store.admit(rec({ attemptId: "g1", uniqueId: "u1", generation: 1 }), NOW);
    await store.admit(rec({ attemptId: "g2", uniqueId: "u2", generation: 2 }), NOW);
    expect((await store.abandonGeneration(1, NOW)).map((r) => r.attemptId)).toEqual(["g1"]);
    expect(await store.get("g1")).toMatchObject({ phase: "done", outcome: "timeout", via: "disconnected" });
    expect((await store.get("g2"))!.phase).toBe("pending");
  });
  it("finds a record by the id on the wire (the lookup used after the instance was recreated)", async () => {
    const store = new StopCommandStore(new MapStorage());
    await store.admit(rec({ attemptId: "x", uniqueId: "wire-1" }), NOW);
    expect((await store.findByUniqueId("wire-1"))!.attemptId).toBe("x");
    expect(await store.findByUniqueId("nope")).toBeUndefined();
  });
});
