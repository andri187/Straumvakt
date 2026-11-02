import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class { constructor(public ctx: unknown, public env: unknown) {} } }));
const { CommandEntrypoint, requestStopVia, promotePendingVia, pendingPresenceVia, MAX_PRESENCE_IDS } = await import("./command-entrypoint");

const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const env = (reply: unknown, seen: { name?: string; url?: string; body?: string }[] = []) => ({
  IDENTITY_DO: {
    idFromName: (n: string) => n,
    get: (id: string) => ({ fetch: async (r: Request) => { seen.push({ name: id, url: r.url, body: await r.text() }); return new Response(JSON.stringify(reply)); } }),
  },
}) as never;

const stopInput = (over: Record<string, unknown> = {}) => ({
  deviceId: DEV, transactionNo: 5, requestId: "req-1", attemptId: "req-1:5:1", placementId: "pl-1", deadlineMs: Date.now() + 60_000, ...over,
}) as never;

describe("CommandEntrypoint", () => {
  it("routes to the per-DEVICE Durable Object and forwards request, attempt, placement, transaction and deadline unchanged", async () => {
    const seen: { name?: string; url?: string; body?: string }[] = [];
    const input = stopInput();
    expect(await requestStopVia(env({ outcome: "accepted" }, seen), input)).toEqual({ outcome: "accepted" });
    const { deviceId: _d, ...rest } = input as Record<string, unknown>;
    expect(seen[0]).toMatchObject({ name: `device:${DEV}`, url: "https://do.internal/command/stop" });
    expect(JSON.parse(seen[0]!.body!)).toEqual(rest); // nothing dropped (the old path lost the request id), nothing invented
  });
  it("passes the device's diagnostic reason through, and treats an unknown outcome as 'unavailable'", async () => {
    expect(await requestStopVia(env({ outcome: "timeout", reason: "uncertain" }), stopInput())).toEqual({ outcome: "timeout", reason: "uncertain" });
    expect(await requestStopVia(env({ outcome: "stopped" }), stopInput())).toEqual({ outcome: "unavailable" });
  });
  it("refuses malformed or out-of-bounds input and a failing Durable Object as 'unavailable' WITHOUT reaching the object", async () => {
    const seen: { name?: string }[] = [];
    const e = env({ outcome: "accepted" }, seen);
    for (const bad of [
      { deviceId: "nope" }, { transactionNo: 0 }, { transactionNo: 2_147_483_648 }, { transactionNo: 1.5 }, { attemptId: "" }, { attemptId: "x".repeat(97) },
      { attemptId: "has space" }, { requestId: 7 }, { placementId: "../p" }, { deadlineMs: Number.NaN }, { deadlineMs: Date.now() + 3_600_000 },
    ]) expect((await requestStopVia(e, stopInput(bad))).outcome, JSON.stringify(bad)).toBe("unavailable");
    expect(seen).toHaveLength(0);
    const throwing = { IDENTITY_DO: { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("boom"); } }) } } as never;
    expect(await requestStopVia(throwing, stopInput())).toEqual({ outcome: "unavailable" });
  });
  it("the class delegates and is not part of the public route table", async () => {
    const e = new CommandEntrypoint({} as never, env({ outcome: "rejected" }));
    expect(await e.requestStop(stopInput())).toEqual({ outcome: "rejected" });
  });
  it("the versioned durable method is the same implementation, so a v1 caller reaches the attempt-keyed stop path", async () => {
    const seen: { name?: string; url?: string; body?: string }[] = [];
    const e = new CommandEntrypoint({} as never, env({ outcome: "accepted" }, seen));
    expect(await e.requestStopV1(stopInput())).toEqual({ outcome: "accepted" });
    expect(seen[0]).toMatchObject({ name: `device:${DEV}`, url: "https://do.internal/command/stop" });
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ attemptId: "req-1:5:1", placementId: "pl-1" });
  });
});

describe("pending charger commands", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  it("promote routes to the per-CPO + charge-point pending object and returns its outcome", async () => {
    const seen: { name?: string; url?: string }[] = [];
    expect(await promotePendingVia(env({ outcome: "reconnect_requested" }, seen), { orgId: ORG, chargePointId: "ZPR074002" })).toEqual({ outcome: "reconnect_requested" });
    expect(seen[0]).toMatchObject({ name: `pending:${ORG}:ZPR074002`, url: "https://do.internal/pending/promote" });
  });
  it("promote refuses malformed input and a failing object as 'unavailable'", async () => {
    expect(await promotePendingVia(env({ outcome: "x" }), { orgId: "nope", chargePointId: "ZPR074002" })).toEqual({ outcome: "unavailable" });
    expect(await promotePendingVia(env({ outcome: "x" }), { orgId: ORG, chargePointId: "../x" })).toEqual({ outcome: "unavailable" });
    const throwing = { IDENTITY_DO: { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("boom"); } }) } } as never;
    expect(await promotePendingVia(throwing, { orgId: ORG, chargePointId: "ZPR074002" })).toEqual({ outcome: "unavailable" });
  });
  it("presence is bounded, de-duplicated and validated; an unreachable object is unknown, not 'not connected'", async () => {
    const names: string[] = [];
    const e = {
      IDENTITY_DO: {
        idFromName: (n: string) => n,
        get: (id: string) => ({ fetch: async () => { names.push(id); if (id.endsWith(":BOOM")) throw new Error("x"); return new Response(JSON.stringify({ connected: id.endsWith(":UP") })); } }),
      },
    } as never;
    const many = Array.from({ length: MAX_PRESENCE_IDS + 10 }, (_, i) => `ID${i}`);
    const r = await pendingPresenceVia(e, { orgId: ORG, chargePointIds: ["UP", "UP", "DOWN", "BOOM", "../bad", ...many] });
    expect(names.length).toBe(MAX_PRESENCE_IDS);
    expect(r.connected).toEqual(["UP"]);
    expect(r.unknown).toEqual(["BOOM"]);
    expect(await pendingPresenceVia(e, { orgId: "bad", chargePointIds: ["UP"] })).toEqual({ connected: [], unknown: [] });
  });
  it("the class delegates", async () => {
    const e = new CommandEntrypoint({} as never, env({ outcome: "not_connected" }));
    expect(await e.promotePending({ orgId: ORG, chargePointId: "ZPR074002" })).toEqual({ outcome: "not_connected" });
  });
});
