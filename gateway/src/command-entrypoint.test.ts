import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class { constructor(public ctx: unknown, public env: unknown) {} } }));
const { CommandEntrypoint, requestStopVia } = await import("./command-entrypoint");

const DEV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const env = (reply: unknown, seen: { name?: string; url?: string; body?: string }[] = []) => ({
  IDENTITY_DO: {
    idFromName: (n: string) => n,
    get: (id: string) => ({ fetch: async (r: Request) => { seen.push({ name: id, url: r.url, body: await r.text() }); return new Response(JSON.stringify(reply)); } }),
  },
}) as never;

describe("CommandEntrypoint", () => {
  it("routes to the per-DEVICE Durable Object and returns its outcome", async () => {
    const seen: { name?: string; url?: string; body?: string }[] = [];
    expect(await requestStopVia(env({ outcome: "accepted" }, seen), { deviceId: DEV, transactionNo: 5, requestId: "r" })).toEqual({ outcome: "accepted" });
    expect(seen[0]).toEqual({ name: `device:${DEV}`, url: "https://do.internal/command/stop", body: JSON.stringify({ transactionNo: 5 }) });
  });
  it("refuses malformed input and a failing Durable Object as 'unavailable'", async () => {
    expect(await requestStopVia(env({ outcome: "accepted" }), { deviceId: "nope", transactionNo: 5, requestId: "r" })).toEqual({ outcome: "unavailable" });
    expect(await requestStopVia(env({ outcome: "accepted" }), { deviceId: DEV, transactionNo: 0, requestId: "r" })).toEqual({ outcome: "unavailable" });
    const throwing = { IDENTITY_DO: { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("boom"); } }) } } as never;
    expect(await requestStopVia(throwing, { deviceId: DEV, transactionNo: 5, requestId: "r" })).toEqual({ outcome: "unavailable" });
  });
  it("the class delegates and is not part of the public route table", async () => {
    const e = new CommandEntrypoint({} as never, env({ outcome: "rejected" }));
    expect(await e.requestStop({ deviceId: DEV, transactionNo: 5, requestId: "r" })).toEqual({ outcome: "rejected" });
  });
});
