import { describe, expect, it, vi } from "vitest";
import { callEngineBatch, type EngineCallBody, type EngineEnv } from "./engine-client";

const bodies = [{ messageId: "1" }, { messageId: "2" }] as EngineCallBody[];
describe("batch transport uncertainty", () => {
  it.each(["missing", "throws", "short", "invalid", "timeout"])("%s response retries every original event without single-call fallback", async mode => {
    const call = vi.fn();
    const env = { ENGINE: { call, admit: vi.fn(), ...(mode === "missing" ? {} : { callBatchV1: async () => {
      if (mode === "throws") throw new Error("transport");
      if (mode === "timeout") return new Promise(() => {});
      if (mode === "short") return [{ kind: "unavailable" }];
      return [{ kind: "answer", answer: {} }, { kind: "unavailable" }];
    } }) } } as unknown as EngineEnv;
    expect(await callEngineBatch(env, bodies, 5)).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }]);
    expect(call).not.toHaveBeenCalled();
  });
});
