import { describe, it, expect, vi } from "vitest";
import {
  ServiceBindingOcppTarget,
  type ClaimedCommand,
} from "./dispatch-targets";

function cmd(overrides: Partial<ClaimedCommand> = {}): ClaimedCommand {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    orgId: "22222222-2222-2222-2222-222222222222",
    identityId: "33333333-3333-3333-3333-333333333333",
    controlDomain: "remote_start",
    routedTo: "ocpp",
    payload: { connectorId: "44444444-4444-4444-4444-444444444444" },
    correlationId: "55555555-5555-5555-5555-555555555555",
    attempts: 1,
    ...overrides,
  };
}

describe("ServiceBindingOcppTarget", () => {
  it("returns 'ack' when gateway responds 202 with an ack body", async () => {
    const body = { kind: "ack", result: { status: "Sent" } };
    const binding = { fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 202 })) };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    const r = await t.dispatch(cmd());
    expect(r.kind).toBe("ack");
  });

  it("maps remote_start → RemoteStartTransaction action in the request body", async () => {
    const binding = {
      fetch: vi.fn(async (req: Request) => {
        const body = (await req.json()) as { action: string };
        expect(body.action).toBe("RemoteStartTransaction");
        return new Response(JSON.stringify({ kind: "ack", result: {} }), { status: 202 });
      }),
    };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    await t.dispatch(cmd());
    expect(binding.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["remote_stop", "RemoteStopTransaction"],
    ["get_configuration", "GetConfiguration"],
    ["change_configuration", "ChangeConfiguration"],
    ["reset", "Reset"],
    ["unlock_connector", "UnlockConnector"],
  ])("maps controlDomain %s → OCPP action %s", async (controlDomain, expectedAction) => {
    let observedAction: string | undefined;
    const binding = {
      fetch: vi.fn(async (req: Request) => {
        const body = (await req.json()) as { action: string };
        observedAction = body.action;
        return new Response(JSON.stringify({ kind: "ack", result: {} }), { status: 202 });
      }),
    };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    const r = await t.dispatch(cmd({ controlDomain }));
    expect(observedAction).toBe(expectedAction);
    expect(r.kind).toBe("ack");
  });

  it("returns 'permanent' for unmapped controlDomain without calling the gateway", async () => {
    const binding = { fetch: vi.fn() };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    const r = await t.dispatch(cmd({ controlDomain: "no_such_domain" }));
    expect(r.kind).toBe("permanent");
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("503 from gateway → retriable (charger may reconnect)", async () => {
    const binding = { fetch: vi.fn(async () => new Response("no ws", { status: 503 })) };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    const r = await t.dispatch(cmd());
    expect(r.kind).toBe("retriable");
  });

  it("5xx from gateway → retriable", async () => {
    const binding = { fetch: vi.fn(async () => new Response("boom", { status: 500 })) };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    expect((await t.dispatch(cmd())).kind).toBe("retriable");
  });

  it("4xx from gateway → permanent", async () => {
    const binding = { fetch: vi.fn(async () => new Response("no", { status: 404 })) };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    expect((await t.dispatch(cmd())).kind).toBe("permanent");
  });

  it("thrown exception from binding → retriable", async () => {
    const binding = {
      fetch: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const t = new ServiceBindingOcppTarget(binding, "secret");
    const r = await t.dispatch(cmd());
    expect(r.kind).toBe("retriable");
    if (r.kind === "retriable") expect(r.error).toContain("network down");
  });

  it("sends the ingest secret header", async () => {
    const binding = {
      fetch: vi.fn(async (req: Request) => {
        expect(req.headers.get("x-straumvakt-ingest")).toBe("the-secret");
        return new Response(JSON.stringify({ kind: "ack", result: {} }), { status: 202 });
      }),
    };
    const t = new ServiceBindingOcppTarget(binding, "the-secret");
    await t.dispatch(cmd());
    expect(binding.fetch).toHaveBeenCalledOnce();
  });
});
