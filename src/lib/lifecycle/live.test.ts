import { describe, expect, it, vi } from "vitest";
import { stopPortFrom, type GatewayCommandBinding } from "./live";

const input = { deviceId: "d", transactionNo: 5, requestId: "r", attemptId: "r:5:1", placementId: "p", deadlineMs: 1 };

describe("stopPortFrom (gateway command contract)", () => {
  it("no binding: no stop port, so removal of a charger with a session in progress stays unavailable", () => {
    expect(stopPortFrom(undefined)).toBeNull();
    expect(stopPortFrom(null)).toBeNull();
  });

  it("calls the VERSIONED durable method with the reserved attempt, placement and deadline unchanged", async () => {
    const requestStopV1 = vi.fn(async () => ({ outcome: "accepted" as const }));
    expect(await stopPortFrom({ requestStopV1 })!.requestStop(input)).toBe("accepted");
    expect(requestStopV1).toHaveBeenCalledWith(input);
  });

  it("fails CLOSED against an older gateway that only has the unversioned, non-durable method", async () => {
    // What the RPC runtime does when the receiver has no such method: the call rejects. Nothing may be sent through `requestStop`.
    const legacy = vi.fn(async () => ({ outcome: "accepted" as const }));
    const binding = {
      requestStop: legacy,
      requestStopV1: async () => { throw new Error('The RPC receiver does not implement the method "requestStopV1".'); },
    } as unknown as GatewayCommandBinding;
    expect(await stopPortFrom(binding)!.requestStop(input)).toBe("unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });

  it("a failing or malformed gateway answer is unavailable, never an invented outcome", async () => {
    expect(await stopPortFrom({ requestStopV1: async () => { throw new Error("boom"); } })!.requestStop(input)).toBe("unavailable");
  });
});
