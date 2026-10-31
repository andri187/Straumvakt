// Entry-Worker tests. The upgrade handler rebuilds the charger's
// request from scratch before handing it to the Durable Object, so
// P4.17's subprotocol offer would be dropped on the floor unless it is
// explicitly relayed. These tests pin that relay — the DO can echo
// only what it is told about.

import { afterEach, describe, expect, it, vi } from "vitest";

// `cloudflare:workers` exists only in the Workers runtime; the entry module re-exports the command entrypoint.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class { constructor(public ctx: unknown, public env: unknown) {} } }));

import worker from "./index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const IDENTITY_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";

function makeEnv(over: Record<string, unknown> = { LEGACY_OCPP_ENABLED: "true" }): { env: WorkerEnv; forwarded: Request[] } {
  const forwarded: Request[] = [];
  const env = {
    ...over,
    IDENTITY_DO: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (req: Request) => {
          forwarded.push(req);
          // Node's Response rejects status 101, and the entry Worker
          // passes whatever the DO returns straight through — the
          // status is irrelevant to what we assert here.
          return new Response("ok", { status: 200 });
        },
      }),
    },
    MAIN_APP: {
      fetch: async () =>
        new Response(JSON.stringify({ identityId: IDENTITY_ID, orgId: ORG_ID }), {
          status: 200,
        }),
    },
    OCPP_INGEST_SECRET: "test-secret",
  } as unknown as WorkerEnv;
  return { env, forwarded };
}

function upgradeRequest(headers: Record<string, string>): Request {
  return new Request("https://gw.internal/ocpp/zpr-test-001", {
    method: "GET",
    headers: { upgrade: "websocket", ...headers },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entry Worker upgrade forwarding", () => {
  it("relays the client's Sec-WebSocket-Protocol offer to the DO", async () => {
    const { env, forwarded } = makeEnv();

    await worker.fetch(
      upgradeRequest({ "sec-websocket-protocol": "ocpp2.0.1, ocpp1.6" }),
      env,
    );

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.headers.get("x-straumvakt-ws-protocol")).toBe(
      "ocpp2.0.1, ocpp1.6",
    );
    expect(forwarded[0]!.headers.get("x-straumvakt-identity-id")).toBe(IDENTITY_ID);
  });

  it("relays no subprotocol header when the client offered none", async () => {
    const { env, forwarded } = makeEnv();

    await worker.fetch(upgradeRequest({}), env);

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.headers.get("x-straumvakt-ws-protocol")).toBeNull();
  });
});

describe("P4.18 invalidate-authorize routing", () => {
  function invalidateRequest(headers: Record<string, string>, body: unknown): Request {
    return new Request(`https://gw.internal/invalidate-authorize/${IDENTITY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("forwards an authenticated call to the identity's DO", async () => {
    const { env, forwarded } = makeEnv();

    const res = await worker.fetch(
      invalidateRequest({ "x-straumvakt-ingest": "test-secret" }, { idTag: "TAG-A" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0]!.url).pathname).toBe("/invalidate-authorize");
    expect(await forwarded[0]!.json()).toEqual({ idTag: "TAG-A" });
  });

  it("rejects a call without the ingest secret and never reaches the DO", async () => {
    const { env, forwarded } = makeEnv();

    const res = await worker.fetch(invalidateRequest({}, { idTag: "TAG-A" }), env);

    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  it("rejects a wrong ingest secret", async () => {
    const { env, forwarded } = makeEnv();

    const res = await worker.fetch(
      invalidateRequest({ "x-straumvakt-ingest": "nope" }, { idTag: "TAG-A" }),
      env,
    );

    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });
});

// ── Adopted path: legacy exclusion and the engine route ──────────────────────

describe("legacy path exclusion (adopted configuration)", () => {
  it("with the switch unset, /ocpp/<id>, /ocpp/1.6/<id>, /dispatch and /invalidate-authorize all answer 404 and never reach the DO or the legacy API", async () => {
    const { env, forwarded } = makeEnv({});
    const mainApp = vi.fn(async () => new Response("{}", { status: 200 }));
    (env as unknown as { MAIN_APP: { fetch: unknown } }).MAIN_APP.fetch = mainApp;
    const cases: [string, string, Record<string, string>][] = [
      ["GET", "https://gw.internal/ocpp/zpr-test-001", { upgrade: "websocket" }],
      ["GET", "https://gw.internal/ocpp/1.6/zpr-test-001", { upgrade: "websocket" }],
      ["POST", `https://gw.internal/dispatch/${IDENTITY_ID}`, { "x-straumvakt-ingest": "test-secret" }],
      ["POST", `https://gw.internal/invalidate-authorize/${IDENTITY_ID}`, { "x-straumvakt-ingest": "test-secret" }],
    ];
    for (const [method, url, headers] of cases) {
      const res = await worker.fetch(new Request(url, { method, headers }), env);
      expect(res.status, url).toBe(404);
    }
    expect(forwarded).toHaveLength(0);
    expect(mainApp).not.toHaveBeenCalled();
  });
  it("only the exact string \"true\" re-enables it", async () => {
    for (const v of ["1", "TRUE", "yes", ""]) {
      const { env } = makeEnv({ LEGACY_OCPP_ENABLED: v });
      const res = await worker.fetch(new Request("https://gw.internal/ocpp/zpr-test-001", { headers: { upgrade: "websocket" } }), env);
      expect(res.status).toBe(404);
    }
  });
  it("/health and /version stay available", async () => {
    const { env } = makeEnv({});
    expect((await worker.fetch(new Request("https://gw.internal/health"), env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://gw.internal/version"), env)).status).toBe(200);
  });
});

describe("engine route", () => {
  const OLD_KEY = "abcdefghijk1"; // the installation segment of the retired URL form
  const ctx = { orgId: "o", installationId: "i", chargePointId: "CP-1", identityString: "o/CP-1", deviceId: "dev-9", placementId: "p", credentialMode: "none", credentialEpoch: "e" };
  const engineEnv = (admit: unknown) => {
    const { env, forwarded } = makeEnv({});
    Object.assign(env, {
      OCPP_ALLOWED_HOSTS: "cpoa.straumvakt.org,cpob.straumvakt.org",
      OCPP_HOST_LIMITER: { limit: async () => ({ success: true }) },
      OCPP_IDENTITY_LIMITER: { limit: async () => ({ success: true }) },
    });
    (env as unknown as { ENGINE: unknown }).ENGINE = { admit, call: async () => ({ kind: "unavailable" }) };
    return { env, forwarded };
  };
  const req = (host = "cpoa.straumvakt.org", path = "/CP-1", upgrade = true) =>
    new Request(`https://${host}${path}`, { headers: upgrade ? { upgrade: "websocket", authorization: "Basic abc" } : {} });

  it("admits through the binding and forwards the resolved context to the per-DEVICE Durable Object", async () => {
    const seen: unknown[] = [];
    const { env, forwarded } = engineEnv(async (i: unknown) => { seen.push(i); return { kind: "admit", context: ctx }; });
    await worker.fetch(req(), env);
    expect(seen).toEqual([{ host: "cpoa.straumvakt.org", pathname: "/CP-1", authorization: "Basic abc" }]);
    expect(forwarded).toHaveLength(1);
    expect(JSON.parse(forwarded[0]!.headers.get("x-straumvakt-engine-ctx")!)).toEqual(ctx);
  });
  describe("pending onboarding (unknown charge point id)", () => {
    const pending = { kind: "pending", orgId: "11111111-1111-4111-8111-111111111111", routingId: "cpoa", chargePointId: "NEW-1" };
    it("flag off: the engine is not asked for pending and an unknown charger keeps the plain 401", async () => {
      const seen: unknown[] = [];
      const { env, forwarded } = engineEnv(async (i: unknown) => { seen.push(i); return { kind: "deny" }; });
      expect((await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env)).status).toBe(401);
      expect(seen[0]).not.toHaveProperty("acceptPending");
      expect(forwarded).toHaveLength(0);
    });
    it("flag off: even a (mis)behaving engine that answers pending is not honoured", async () => {
      const { env, forwarded } = engineEnv(async () => pending);
      expect((await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env)).status).toBe(503);
      expect(forwarded).toHaveLength(0);
    });
    /** Replaces the fake Durable Object namespace with one that records every request and answers the admission gate. */
    // `upgrade` is what the pending object answers the forwarded upgrade with: a completed upgrade (101), a refusal such as a
    // bad subprotocol (400), or a thrown error. A 101 cannot be built with the Node Response, so it is a plain object.
    const withGate = (env: unknown, gate: "grant" | "deny" | "down", upgrade: "ok" | "refused" | "throws" = "ok") => {
      const seen: { name: string; req: Request }[] = [];
      (env as { IDENTITY_DO: unknown }).IDENTITY_DO = {
        idFromName: (n: string) => n,
        get: (name: string) => ({
          fetch: async (req: Request) => {
            seen.push({ name, req });
            const path = new URL(req.url).pathname;
            if (path === "/gate/acquire") {
              if (gate === "down") throw new Error("gate unreachable");
              return new Response(JSON.stringify({ ok: gate === "grant" }));
            }
            if (path === "/pending/ws") {
              if (upgrade === "throws") throw new Error("pending object unreachable");
              return upgrade === "ok" ? ({ status: 101 } as unknown as Response) : new Response("unsupported websocket subprotocol", { status: 400 });
            }
            return new Response(JSON.stringify({ ok: true }));
          },
        }),
      };
      return seen;
    };
    it("flag on: takes a lease at the per-CPO gate FIRST, then routes to the per-CPO + charge-point PENDING object, with no device context", async () => {
      const seen: unknown[] = [];
      const { env } = engineEnv(async (i: unknown) => { seen.push(i); return pending; });
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      const calls = withGate(env, "grant");
      await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env);
      expect(seen[0]).toMatchObject({ acceptPending: true });
      expect(calls.map((c) => [c.name, new URL(c.req.url).pathname])).toEqual([[`pending-gate:${pending.orgId}`, "/gate/acquire"], [`pending:${pending.orgId}:NEW-1`, "/pending/ws"]]);
      const acquired = (await calls[0]!.req.json()) as { id: string; attempt: string };
      const { attempt } = acquired;
      expect(acquired).toEqual({ id: "NEW-1", attempt: expect.any(String) });
      // The same token reaches the pending object: it becomes the owner token of the connection this upgrade creates.
      expect(calls[1]!.req.headers.get("x-straumvakt-pending-attempt")).toBe(attempt);
      expect(calls[1]!.req.headers.get("x-straumvakt-engine-ctx")).toBeNull();
      expect(JSON.parse(calls[1]!.req.headers.get("x-straumvakt-pending-ctx")!)).toEqual({ orgId: pending.orgId, routingId: "cpoa", chargePointId: "NEW-1" });
    });
    it("flag on: a completed upgrade keeps its lease (no release call)", async () => {
      const { env } = engineEnv(async () => pending);
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      const calls = withGate(env, "grant", "ok");
      expect((await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env)).status).toBe(101);
      expect(calls.map((c) => new URL(c.req.url).pathname)).toEqual(["/gate/acquire", "/pending/ws"]);
    });
    it("REVIEW CASE: an upgrade the pending object refuses (e.g. unsupported subprotocol) gives back the lease it took, with the same attempt token", async () => {
      const { env } = engineEnv(async () => pending);
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      const calls = withGate(env, "grant", "refused");
      const res = await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env);
      expect(res.status).toBe(400);
      expect(calls.map((c) => [c.name, new URL(c.req.url).pathname])).toEqual([
        [`pending-gate:${pending.orgId}`, "/gate/acquire"],
        [`pending:${pending.orgId}:NEW-1`, "/pending/ws"],
        [`pending-gate:${pending.orgId}`, "/gate/release"],
      ]);
      const acquired = (await calls[0]!.req.json()) as { id: string; attempt: string };
      const released = (await calls[2]!.req.json()) as { id: string; attempt: string };
      expect(released).toEqual({ id: "NEW-1", attempt: acquired.attempt });
    });
    it("flag on: each upgrade attempt carries its own token", async () => {
      const { env } = engineEnv(async () => pending);
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      const calls = withGate(env, "grant", "refused");
      await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env);
      await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env);
      const tokens = await Promise.all(calls.filter((c) => new URL(c.req.url).pathname === "/gate/acquire").map(async (c) => ((await c.req.json()) as { attempt: string }).attempt));
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).not.toBe(tokens[1]);
    });
    it("REVIEW CASE: a forwarding failure is a 503 and does NOT give the claim back (the object may already have accepted the socket)", async () => {
      const { env } = engineEnv(async () => pending);
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      const calls = withGate(env, "grant", "throws");
      expect((await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env)).status).toBe(503);
      // No release: an accepted connection confirms its own claim on its first boot, and an unused claim lapses within the
      // first-boot deadline. Releasing here could free the slot of a socket that exists.
      expect(calls.map((c) => new URL(c.req.url).pathname)).toEqual(["/gate/acquire", "/pending/ws"]);
    });
    it("a second upgrade of the same id while one is in flight is refused by the gate with a 429 and allocates no pending object", async () => {
      const { env } = engineEnv(async () => pending);
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      const calls = withGate(env, "deny");
      const res = await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
      expect(calls.map((c) => new URL(c.req.url).pathname)).toEqual(["/gate/acquire"]); // and nothing to release: it holds no claim
    });
    it("a refused upgrade still reports its own status when the lease cannot be given back", async () => {
      const { env } = engineEnv(async () => pending);
      (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      withGate(env, "grant", "refused");
      const ns = (env as unknown as { IDENTITY_DO: { get: (n: string) => { fetch: (r: Request) => Promise<Response> } } }).IDENTITY_DO;
      const inner = ns.get.bind(ns);
      ns.get = (name: string) => {
        const stub = inner(name);
        return { fetch: async (r: Request) => { if (new URL(r.url).pathname === "/gate/release") throw new Error("gate unreachable"); return stub.fetch(r); } };
      };
      expect((await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env)).status).toBe(400);
    });
    it("flag on: a CPO at its pending-socket cap is a 429 and allocates NO pending object; an unreachable gate is a 503 (fail closed)", async () => {
      for (const [gate, status] of [["deny", 429], ["down", 503]] as const) {
        const { env } = engineEnv(async () => pending);
        (env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
        const calls = withGate(env, gate);
        const res = await worker.fetch(req("cpoa.straumvakt.org", "/NEW-1"), env);
        expect(res.status, gate).toBe(status);
        expect(calls.every((c) => new URL(c.req.url).pathname === "/gate/acquire"), gate).toBe(true);
      }
    });
    it("flag on: a registered charger still goes to its DEVICE object and a refusal is still a 401", async () => {
      const a = engineEnv(async () => ({ kind: "admit", context: ctx }));
      (a.env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      await worker.fetch(req(), a.env);
      expect(new URL(a.forwarded[0]!.url).pathname).toBe("/ws");
      const d = engineEnv(async () => ({ kind: "deny" }));
      (d.env as unknown as { PENDING_ONBOARDING: string }).PENDING_ONBOARDING = "true";
      expect((await worker.fetch(req(), d.env)).status).toBe(401);
    });
    it("the pending paths are not public routes", async () => {
      const { env, forwarded } = engineEnv(async () => pending);
      for (const path of ["/pending/promote", "/pending/presence", "/pending/ws"]) {
        expect([404, 426]).toContain((await worker.fetch(new Request(`https://cpoa.straumvakt.org${path}`, { method: "POST" }), env)).status);
      }
      expect(forwarded).toHaveLength(0);
    });
  });
  it("a refusal is a plain 401 and an unavailable engine a 503; neither reaches a Durable Object", async () => {
    const deny = engineEnv(async () => ({ kind: "deny" }));
    expect((await worker.fetch(req(), deny.env)).status).toBe(401);
    const down = engineEnv(async () => ({ kind: "unavailable" }));
    expect((await worker.fetch(req(), down.env)).status).toBe(503);
    const throwing = engineEnv(async () => { throw new Error("boom"); });
    expect((await worker.fetch(req(), throwing.env)).status).toBe(503);
    expect(deny.forwarded.length + down.forwarded.length + throwing.forwarded.length).toBe(0);
  });
  it("with no ENGINE binding configured the route fails closed (503), never open", async () => {
    const { env, forwarded } = makeEnv({});
    expect((await worker.fetch(req(), env)).status).toBe(503);
    expect(forwarded).toHaveLength(0);
  });
  it("only *.straumvakt.org hosts and well-formed paths are considered; non-upgrade is 426", async () => {
    const { env } = engineEnv(async () => ({ kind: "admit", context: ctx }));
    expect((await worker.fetch(req("evil.example.com"), env)).status).toBe(404);
    expect((await worker.fetch(req("cpoa.straumvakt.org", "/CP-1", false), env)).status).toBe(426);
  });
  it("the retired /{installation-key}/{charge-point-id} form and other multi-segment paths are a 404 and never reach the engine", async () => {
    const seen: unknown[] = [];
    const { env, forwarded } = engineEnv(async (i: unknown) => { seen.push(i); return { kind: "admit", context: ctx }; });
    for (const path of [`/${OLD_KEY}/CP-1`, "/ocpp/CP-1", "/CP-1/extra", "/a/b/c"]) {
      expect((await worker.fetch(req("cpoa.straumvakt.org", path), env)).status, path).toBe(404);
    }
    expect(seen).toEqual([]);
    expect(forwarded).toHaveLength(0);
  });
  it("a WebSocket upgrade for a charger called 'health' or 'version' reaches the engine, while a plain GET still answers the probe", async () => {
    for (const id of ["health", "version"]) {
      const seen: unknown[] = [];
      const { env, forwarded } = engineEnv(async (i: unknown) => { seen.push(i); return { kind: "admit", context: ctx }; });
      await worker.fetch(req("cpoa.straumvakt.org", `/${id}`), env);
      expect(seen, id).toEqual([expect.objectContaining({ pathname: `/${id}` })]);
      expect(forwarded, id).toHaveLength(1);
      expect((await worker.fetch(new Request(`https://cpoa.straumvakt.org/${id}`), env)).status, id).toBe(200);
    }
  });
  it("the device Durable Object is chosen by the permanent device id from the admitted context, not by anything in the URL", async () => {
    const { env } = engineEnv(async () => ({ kind: "admit", context: ctx }));
    const names: string[] = [];
    const ns = (env as unknown as { IDENTITY_DO: { idFromName: (n: string) => unknown } }).IDENTITY_DO;
    const original = ns.idFromName.bind(ns);
    ns.idFromName = (n: string) => { names.push(n); return original(n); };
    await worker.fetch(req("cpoa.straumvakt.org", "/CP-1"), env);
    await worker.fetch(req("cpob.straumvakt.org", "/CP-1"), env); // same id, other CPO host: still the admitted device's own object
    expect(names).toEqual(["device:dev-9", "device:dev-9"]);
  });
  it("refuses malformed identities, non-GET upgrades and excessive auth before any engine call", async () => {
    const admission = vi.fn(async () => ({ kind: "deny" }));
    const { env } = engineEnv(admission);
    for (const path of ["/%7BdeviceId%7D", "/" + "a".repeat(49), "/bad%20id"]) {
      expect((await worker.fetch(req("cpoa.straumvakt.org", path), env)).status).toBe(400);
    }
    expect((await worker.fetch(new Request("https://cpoa.straumvakt.org/CP-1", { method: "POST", headers: { upgrade: "websocket" } }), env)).status).toBe(400);
    expect((await worker.fetch(new Request("https://cpoa.straumvakt.org/CP-1", { headers: { upgrade: "websocket", authorization: "x".repeat(1025) } }), env)).status).toBe(400);
    expect(admission).not.toHaveBeenCalled();
  });
  it("missing or failed limiters and an unconfigured host never reach admission", async () => {
    const admission = vi.fn(async () => ({ kind: "deny" }));
    const { env } = engineEnv(admission);
    expect((await worker.fetch(req("unknown.straumvakt.org"), env)).status).toBe(404);
    Object.assign(env, { OCPP_HOST_LIMITER: undefined });
    expect((await worker.fetch(req(), env)).status).toBe(503);
    Object.assign(env, { OCPP_HOST_LIMITER: { limit: async () => { throw new Error("unavailable"); } } });
    expect((await worker.fetch(req(), env)).status).toBe(503);
    expect(admission).not.toHaveBeenCalled();
  });
  it("same-id bursts make one admission call, and another identity can still be admitted", async () => {
    const admission = vi.fn(async () => ({ kind: "deny" }));
    const { env, forwarded } = engineEnv(admission);
    const keys = new Set<string>();
    Object.assign(env, { OCPP_IDENTITY_LIMITER: { limit: async ({ key }: { key: string }) => {
      const success = !keys.has(key); keys.add(key); return { success };
    } } });
    expect((await worker.fetch(req(), env)).status).toBe(401);
    for (let i = 0; i < 20; i++) expect((await worker.fetch(req(), env)).status).toBe(429);
    expect(admission).toHaveBeenCalledTimes(1);
    expect((await worker.fetch(req("cpoa.straumvakt.org", "/CP-2"), env)).status).toBe(401);
    expect(admission).toHaveBeenCalledTimes(2);
    expect(forwarded).toHaveLength(0);
  });
  it("rotating-id bursts are gated by the fixed host key before identity or engine work", async () => {
    const admission = vi.fn(async () => ({ kind: "deny" }));
    const { env } = engineEnv(admission);
    let count = 0;
    const host = vi.fn(async (_input: { key: string }) => ({ success: ++count <= 6 }));
    const identity = vi.fn(async () => ({ success: true }));
    Object.assign(env, { OCPP_HOST_LIMITER: { limit: host }, OCPP_IDENTITY_LIMITER: { limit: identity } });
    for (let i = 0; i < 30; i++) expect((await worker.fetch(req("cpoa.straumvakt.org", `/CP-${i}`), env)).status).toBe(i < 6 ? 401 : 429);
    expect(admission).toHaveBeenCalledTimes(6);
    expect(identity).toHaveBeenCalledTimes(6);
    expect(host.mock.calls.every(([input]) => input.key === "cpoa.straumvakt.org")).toBe(true);
    // This verifies the handler's call counts against deterministic doubles,
    // not a strict global limit from Cloudflare's approximate API.
  });
});

describe("command entrypoint is not a route", () => {
  it("the public fetch handler gives /command/* and engine-shaped RPC paths a 404 and never reaches a Durable Object", async () => {
    const { env, forwarded } = makeEnv({});
    for (const [method, path] of [["POST", "/command/stop"], ["POST", "/requestStop"], ["GET", "/command"]] as const) {
      expect((await worker.fetch(new Request(`https://gw.internal${path}`, { method }), env)).status, path).toBe(404);
    }
    expect(forwarded).toHaveLength(0);
  });
});
