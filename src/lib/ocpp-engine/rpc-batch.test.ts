import { describe, expect, it } from "vitest";
import { rpcCallBatch, type EngineRpcDeps } from "./rpc";
import { memoryTxStore } from "./__tests__/memory-tx-store";

const ctx = { orgId: "o", installationId: "i", chargePointId: "c", identityString: "o/c", deviceId: "d", placementId: "p", credentialEpoch: "1", credentialMode: "none" };
const entry = (n: number) => ({ ctx, messageId: `m${n}`, action: "StatusNotification", payload: { connectorId: 1, status: n % 2 ? "Charging" : "Available", errorCode: "NoError" }, receivedAt: new Date(1000 + n).toISOString() });
function fixture() {
  const mem = memoryTxStore();
  let opens = 0;
  const deps: EngineRpcDeps = { now: () => new Date(), heartbeatIntervalSeconds: 3600, withAdmission: async () => null,
    withEngine: async fn => { opens++; return fn({ store: mem.store }); } };
  return { mem, deps, opens: () => opens };
}
describe("bounded transport batch", () => {
  it("20 events use one client but retain 20 separate transactions", async () => {
    const f = fixture();
    const out = await rpcCallBatch(f.deps, Array.from({ length: 20 }, (_, i) => entry(i)));
    expect(out.every(o => o.kind === "answer" && o.answer.kind === "result")).toBe(true);
    expect(f.opens()).toBe(1);
    expect(f.mem.stats.runs).toBe(20);
  });
  it("rejects mixed tenants, placements, synchronous commands and oversized batches before DB access", async () => {
    for (const second of [{ ...entry(2), ctx: { ...ctx, orgId: "other" } }, { ...entry(2), ctx: { ...ctx, placementId: "old" } }, { ...entry(2), action: "StopTransaction" }]) {
      const f = fixture();
      expect(await rpcCallBatch(f.deps, [entry(1), second])).toEqual([{ kind: "rejected", status: 400 }, { kind: "rejected", status: 400 }]);
      expect(f.opens()).toBe(0);
    }
    const f = fixture();
    expect(await rpcCallBatch(f.deps, Array.from({ length: 21 }, (_, i) => entry(i)))).toEqual([]);
    expect(f.opens()).toBe(0);
  });
  it("isolates invalid entries without discarding valid neighbours", async () => {
    const f = fixture();
    const out = await rpcCallBatch(f.deps, [entry(1), { ...entry(2), payload: {} }, entry(3)]);
    expect(out.map(o => o.kind === "answer" ? o.answer.kind : o.kind)).toEqual(["result", "error", "result"]);
    expect(f.mem.stats.runs).toBe(2);
  });
  it("on first DB failure stops all remaining database work and marks every unprocessed event retryable", async () => {
    const f = fixture();
    let runs = 0;
    f.mem.store.run = async () => { runs++; throw new Error("down"); };
    expect(await rpcCallBatch(f.deps, [entry(1), entry(2), entry(3)])).toEqual(Array.from({ length: 3 }, () => ({ kind: "unavailable" })));
    expect(runs).toBe(1);
    expect(f.opens()).toBe(1);
  });
  it("limits UTF-8 bytes, not character count", async () => {
    const f = fixture();
    const out = await rpcCallBatch(f.deps, [{ ...entry(1), payload: { value: "🧪".repeat(18000) } }]);
    expect(out).toEqual([{ kind: "rejected", status: 413 }]);
    expect(f.mem.stats.runs).toBe(0);
  });
});
