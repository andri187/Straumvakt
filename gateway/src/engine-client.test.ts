import { beforeEach, describe, expect, it, vi } from "vitest";
import { BATCH_REPROBE_MS, callEngineBatch, resetBatchCapability, type EngineCallBody, type EngineEnv } from "./engine-client";

const bodies = [{ messageId: "1" }, { messageId: "2" }] as EngineCallBody[];
const answer = { kind: "answer", answer: { kind: "result", payload: {} } } as const;
beforeEach(() => resetBatchCapability());

describe("batch transport uncertainty", () => {
  it.each(["throws", "short", "invalid", "timeout"])("%s response retries every original event without single-call fallback", async mode => {
    const call = vi.fn();
    const env = { ENGINE: { call, admit: vi.fn(), callBatchV1: async () => {
      if (mode === "throws") throw new Error("transport");
      if (mode === "timeout") return new Promise(() => {});
      if (mode === "short") return [{ kind: "unavailable" }];
      return [{ kind: "answer", answer: {} }, { kind: "unavailable" }];
    } } } as unknown as EngineEnv;
    expect(await callEngineBatch(env, bodies, 5)).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }]);
    expect(call).not.toHaveBeenCalled();
  });

  it("an unbound engine is unavailable and sends nothing", async () => {
    expect(await callEngineBatch({} as EngineEnv, bodies, 5)).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }]);
  });
});

// Staged rollout / rollback: the gateway can be released before the shell (or the shell rolled back), so a missing batch
// method must still drain evidence. Only a PROOF that the batch never ran allows the per-event contract.
describe("batch method absent on the shell (mixed-version safety)", () => {
  const missing = () => new Error('The RPC receiver does not implement the method "callBatchV1".');

  it("a plain missing property delivers each event on the older contract, in order", async () => {
    const seen: string[] = [];
    const call = vi.fn(async (b: EngineCallBody) => { seen.push(b.messageId); return answer; });
    const out = await callEngineBatch({ ENGINE: { call, admit: vi.fn() } } as unknown as EngineEnv, bodies, 5);
    expect(out).toEqual([answer, answer]);
    expect(seen).toEqual(["1", "2"]);
  });

  it("the runtime's 'does not implement' rejection (the real service-binding shape) falls back, then remembers it", async () => {
    const callBatchV1 = vi.fn(async () => { throw missing(); });
    const call = vi.fn(async () => answer);
    const env = { ENGINE: { call, admit: vi.fn(), callBatchV1 } } as unknown as EngineEnv;
    let t = 1_000;
    expect(await callEngineBatch(env, bodies, 5, () => t)).toEqual([answer, answer]);
    expect(callBatchV1).toHaveBeenCalledTimes(1);
    // Within the window the doomed call is skipped entirely: no wasted RPC per drain.
    t += BATCH_REPROBE_MS - 1;
    expect(await callEngineBatch(env, bodies, 5, () => t)).toEqual([answer, answer]);
    expect(callBatchV1).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(4);
    // After the window it probes again (the shell may have been upgraded): a working batch is used once more.
    callBatchV1.mockImplementationOnce(async () => bodies.map(b => ({ messageId: b.messageId, outcome: answer })) as never);
    t += 2;
    expect(await callEngineBatch(env, bodies, 5, () => t)).toEqual([answer, answer]);
    expect(callBatchV1).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("keeps per-device order: the first unavailable event stops the run and later events are not delivered ahead of it", async () => {
    const seen: string[] = [];
    const call = vi.fn(async (b: EngineCallBody) => { seen.push(b.messageId); return b.messageId === "1" ? ({ kind: "unavailable" } as const) : answer; });
    const out = await callEngineBatch({ ENGINE: { call, admit: vi.fn() } } as unknown as EngineEnv, bodies, 5);
    expect(out).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }]);
    expect(seen).toEqual(["1"]);
  });

  it("a rejected (poison) event does not hold back the healthy ones behind it", async () => {
    const call = vi.fn(async (b: EngineCallBody) => (b.messageId === "1" ? ({ kind: "rejected", status: 422 } as const) : answer));
    const out = await callEngineBatch({ ENGINE: { call, admit: vi.fn() } } as unknown as EngineEnv, bodies, 5);
    expect(out).toEqual([{ kind: "rejected", status: 422 }, answer]);
  });

  it("any OTHER rejection is uncertain: nothing is re-sent individually", async () => {
    const call = vi.fn();
    const env = { ENGINE: { call, admit: vi.fn(), callBatchV1: async () => { throw new Error("Network connection lost."); } } } as unknown as EngineEnv;
    expect(await callEngineBatch(env, bodies, 5)).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }]);
    expect(call).not.toHaveBeenCalled();
  });
});
